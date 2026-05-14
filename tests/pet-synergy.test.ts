import { describe, expect, test } from "bun:test";
import { SYNERGY_WINDOW_MS, detectSynergy } from "../src/pet/synergy.ts";
import {
  ACTION_HISTORY_LIMIT,
  appendActionHistory,
  type ActionHistoryEntry,
  type PetStats,
} from "../src/pet/petState.ts";

function baseStats(history: ActionHistoryEntry[] = []): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 100,
    actionHistory: history.length > 0 ? history : undefined,
  };
}

describe("synergy combos", () => {
  test("rainmaker fires on work → play → praise", () => {
    const t = 1_000_000;
    const stats = baseStats([
      { action: "work", at: t },
      { action: "play", at: t + 1000 },
      { action: "praise", at: t + 2000 },
    ]);
    const r = detectSynergy(stats, t + 2500);
    expect(r.matched?.id).toBe("rainmaker");
    expect(r.stats.happiness).toBeGreaterThan(50);
    expect(r.stats.deals).toBeGreaterThan(50);
  });

  test("grind fires on feed → work → work", () => {
    const t = 1_000_000;
    const stats = baseStats([
      { action: "feed", at: t },
      { action: "work", at: t + 1000 },
      { action: "work", at: t + 2000 },
    ]);
    const r = detectSynergy(stats, t + 2500);
    expect(r.matched?.id).toBe("grind");
    expect(r.stats.deals).toBe(70);
  });

  test("promotion_arc bumps lifetimeDeals", () => {
    const t = 1_000_000;
    const stats = baseStats([
      { action: "rest", at: t },
      { action: "work", at: t + 1000 },
      { action: "praise", at: t + 2000 },
    ]);
    const r = detectSynergy(stats, t + 2500);
    expect(r.matched?.id).toBe("promotion_arc");
    expect(r.stats.lifetimeDeals).toBe(110);
  });

  test("no match if window exceeded", () => {
    const t = 1_000_000;
    const stats = baseStats([
      { action: "work", at: t },
      { action: "play", at: t + 1000 },
      { action: "praise", at: t + 2000 },
    ]);
    const r = detectSynergy(stats, t + SYNERGY_WINDOW_MS + 10_000);
    expect(r.matched).toBeNull();
    expect(r.stats).toBe(stats);
  });

  test("consumed entries are cleared", () => {
    const t = 1_000_000;
    const stats = baseStats([
      { action: "feed", at: t },
      { action: "work", at: t + 1000 },
      { action: "work", at: t + 2000 },
    ]);
    const r = detectSynergy(stats, t + 2500);
    expect(r.matched).not.toBeNull();
    expect(r.stats.actionHistory).toBeUndefined();
  });

  test("appendActionHistory caps at limit", () => {
    let stats: PetStats = baseStats();
    for (let i = 0; i < ACTION_HISTORY_LIMIT + 3; i++) {
      stats = appendActionHistory(stats, "work", i);
    }
    expect(stats.actionHistory?.length).toBe(ACTION_HISTORY_LIMIT);
  });

  test("non-matching sequence returns same stats identity", () => {
    const stats = baseStats([
      { action: "work", at: 0 },
      { action: "feed", at: 100 },
    ]);
    const r = detectSynergy(stats, 200);
    expect(r.stats).toBe(stats);
  });
});
