import { describe, expect, test } from "bun:test";
import { BOSS_QUARTERLY, advanceBoss, renderBoss, startBoss } from "../src/pet/boss.ts";
import type { PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 600,
    ...overrides,
  };
}

describe("boss encounter", () => {
  test("startBoss installs record", () => {
    const r = startBoss(baseStats(), BOSS_QUARTERLY, 1_000);
    expect(r.ok).toBe(true);
    expect(r.stats.boss?.id).toBe("quarterly_earnings");
    expect(r.stats.boss?.step).toBe(0);
  });

  test("startBoss refuses when one already active (V59)", () => {
    const seeded = startBoss(baseStats(), BOSS_QUARTERLY, 1_000).stats;
    const r2 = startBoss(seeded, BOSS_QUARTERLY, 2_000);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("already_active");
  });

  test("advanceBoss progresses on correct trigger, ignores others", () => {
    const seeded = startBoss(baseStats(), BOSS_QUARTERLY, 0).stats;
    const r1 = advanceBoss(seeded, "praise", 1_000);
    expect(r1.advanced).toBe(false);
    expect(r1.stats).toBe(seeded);
    const r2 = advanceBoss(seeded, "work", 1_000);
    expect(r2.advanced).toBe(true);
    expect(r2.stats.boss?.step).toBe(1);
  });

  test("advanceBoss completes after final step + bumps lifetimeDeals", () => {
    let s = startBoss(baseStats(), BOSS_QUARTERLY, 0).stats;
    s = advanceBoss(s, "work", 1).stats;
    s = advanceBoss(s, "trade_win", 2).stats;
    s = advanceBoss(s, "audit_response", 3).stats;
    const final = advanceBoss(s, "praise", 4);
    expect(final.completed).toBe(true);
    expect(final.stats.boss).toBeUndefined();
    expect(final.stats.lifetimeDeals).toBe(600 + BOSS_QUARTERLY.reward);
  });

  test("advanceBoss expires past deadline + hits happiness (V59)", () => {
    let s = startBoss(baseStats(), BOSS_QUARTERLY, 0).stats;
    s = advanceBoss(s, "work", 1).stats;
    const past = advanceBoss(s, "trade_win", BOSS_QUARTERLY.durationMs + 1);
    expect(past.expired).toBe(true);
    expect(past.stats.boss).toBeUndefined();
    expect(past.stats.happiness).toBeLessThan(50);
  });

  test("advanceBoss no-op when no active boss", () => {
    const r = advanceBoss(baseStats(), "work", 1);
    expect(r.advanced).toBe(false);
    expect(r.stats).toEqual(baseStats());
  });

  test("renderBoss formats progress", () => {
    const seeded = startBoss(baseStats(), BOSS_QUARTERLY, 0).stats;
    expect(renderBoss(seeded, 0)).toContain("QUARTERLY");
    expect(renderBoss(baseStats())).toContain("No active");
  });
});
