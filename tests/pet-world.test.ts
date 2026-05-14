import { describe, expect, test } from "bun:test";
import {
  WORLD_EVENTS,
  activeWorldEvent,
  defaultWorldScheduler,
  expireWorldEvent,
  maybeSpawnWorldEvent,
  renderWorldEvent,
  worldDecayMultiplier,
  worldEventGapMultiplier,
  worldTradeLossMultiplier,
  worldWorkDealMultiplier,
} from "../src/pet/world.ts";
import type { PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    ...overrides,
  };
}

function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

describe("world events", () => {
  test("activeWorldEvent honors expiresAt", () => {
    const stats = baseStats({
      worldEvent: { kind: "ipo_mania", startedAt: 0, expiresAt: 100 },
    });
    expect(activeWorldEvent(stats, 50)?.kind).toBe("ipo_mania");
    expect(activeWorldEvent(stats, 100)).toBeNull();
  });

  test("maybeSpawnWorldEvent respects probability gate", () => {
    const stats = baseStats();
    const scheduler = defaultWorldScheduler(fixedRng([0.9]));
    const r = maybeSpawnWorldEvent(stats, 0, scheduler);
    expect(r.spawned).toBeNull();
  });

  test("maybeSpawnWorldEvent spawns when shouldSpawn true and none active", () => {
    const stats = baseStats();
    const scheduler = {
      shouldSpawn: () => true,
      pickEvent: () => WORLD_EVENTS[0]!,
    };
    const r = maybeSpawnWorldEvent(stats, 1_000, scheduler);
    expect(r.spawned?.kind).toBeDefined();
    expect(r.stats.worldEvent?.kind).toBe(r.spawned!.kind);
  });

  test("expireWorldEvent removes record at deadline (V58)", () => {
    const stats = baseStats({
      worldEvent: { kind: "holiday", startedAt: 0, expiresAt: 100 },
    });
    const r = expireWorldEvent(stats, 200);
    expect(r.expired?.kind).toBe("holiday");
    expect(r.stats.worldEvent).toBeUndefined();
  });

  test("modifier helpers default to 1 when no event", () => {
    const stats = baseStats();
    expect(worldDecayMultiplier(stats)).toBe(1);
    expect(worldWorkDealMultiplier(stats)).toBe(1);
    expect(worldTradeLossMultiplier(stats)).toBe(1);
    expect(worldEventGapMultiplier(stats)).toBe(1);
  });

  test("modifier helpers match per-kind values", () => {
    const holiday = baseStats({
      worldEvent: { kind: "holiday", startedAt: 0, expiresAt: 1_000_000 },
    });
    const crash = baseStats({
      worldEvent: { kind: "market_crash", startedAt: 0, expiresAt: 1_000_000 },
    });
    const ipo = baseStats({
      worldEvent: { kind: "ipo_mania", startedAt: 0, expiresAt: 1_000_000 },
    });
    const audit = baseStats({
      worldEvent: { kind: "audit_week", startedAt: 0, expiresAt: 1_000_000 },
    });
    expect(worldDecayMultiplier(holiday, 0)).toBe(0.5);
    expect(worldTradeLossMultiplier(crash, 0)).toBe(2);
    expect(worldWorkDealMultiplier(ipo, 0)).toBe(1.5);
    expect(worldEventGapMultiplier(audit, 0)).toBe(0.5);
  });

  test("renderWorldEvent handles empty + populated", () => {
    expect(renderWorldEvent(baseStats())).toContain("No active");
    const stats = baseStats({
      worldEvent: { kind: "holiday", startedAt: 0, expiresAt: 60 * 60_000 },
    });
    expect(renderWorldEvent(stats, 0)).toContain("HOLIDAY");
  });
});
