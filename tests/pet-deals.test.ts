import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_ACTIVE_DEALS,
  defaultDealScheduler,
  formatDeal,
  listDeals,
  maybeOfferDeal,
  resetDealCounter,
  spawnDeal,
  tickDeals,
} from "../src/pet/deals.ts";
import type { ActiveDeal, PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 100,
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

describe("active deals", () => {
  beforeEach(() => resetDealCounter());

  test("spawnDeal assigns deadline + reward from template", () => {
    const scheduler = defaultDealScheduler(fixedRng([0]));
    const deal = spawnDeal(1_000_000, scheduler);
    expect(deal.id).toMatch(/^deal_/);
    expect(deal.deadline).toBeGreaterThan(1_000_000);
    expect(deal.reward).toBeGreaterThan(0);
    expect(deal.requirements.length).toBeGreaterThan(0);
  });

  test("maybeOfferDeal respects concurrent cap", () => {
    const scheduler = defaultDealScheduler(fixedRng([0]));
    const filler: ActiveDeal[] = Array.from({ length: MAX_ACTIVE_DEALS }, (_, i) => ({
      id: `pre_${i}`,
      name: "filler",
      requirements: [{ action: "work", count: 1 }],
      deadline: Date.now() + 60_000,
      started: 0,
      progress: {},
      reward: 10,
    }));
    const stats = baseStats({ activeDeals: filler });
    const { stats: next, offered } = maybeOfferDeal(stats, 1_000, scheduler);
    expect(offered).toBeNull();
    expect(next.activeDeals?.length).toBe(MAX_ACTIVE_DEALS);
  });

  test("maybeOfferDeal honors explicit pipeline cap of 3", () => {
    const scheduler = { ...defaultDealScheduler(fixedRng([0])), shouldSpawn: () => true };
    const filler: ActiveDeal[] = Array.from({ length: 2 }, (_, i) => ({
      id: `pre_${i}`,
      name: "filler",
      requirements: [{ action: "work", count: 1 }],
      deadline: Date.now() + 60_000,
      started: 0,
      progress: {},
      reward: 10,
    }));
    const { stats: next, offered } = maybeOfferDeal(
      baseStats({ activeDeals: filler }),
      1_000,
      scheduler,
      3,
    );
    expect(offered).not.toBeNull();
    expect(next.activeDeals?.length).toBe(3);
    expect(maybeOfferDeal(next, 2_000, scheduler, 3).offered).toBeNull();
  });

  test("maybeOfferDeal skips when shouldSpawn returns false", () => {
    const scheduler = { ...defaultDealScheduler(), shouldSpawn: () => false };
    const stats = baseStats();
    const { offered } = maybeOfferDeal(stats, 0, scheduler);
    expect(offered).toBeNull();
  });

  test("maybeOfferDeal appends when slot free + rolls in", () => {
    const scheduler = { ...defaultDealScheduler(fixedRng([0])), shouldSpawn: () => true };
    const stats = baseStats();
    const { stats: next, offered } = maybeOfferDeal(stats, 0, scheduler);
    expect(offered).not.toBeNull();
    expect(next.activeDeals?.length).toBe(1);
  });

  test("tickDeals advances progress for matching action", () => {
    const deal: ActiveDeal = {
      id: "d1",
      name: "Test",
      requirements: [{ action: "work", count: 2 }],
      deadline: 100_000,
      started: 0,
      progress: {},
      reward: 25,
    };
    const stats = baseStats({ activeDeals: [deal] });
    const r1 = tickDeals(stats, "work", 1);
    expect(r1.stats.activeDeals?.[0]?.progress.work).toBe(1);
    expect(r1.completed.length).toBe(0);
    const r2 = tickDeals(r1.stats, "work", 2);
    expect(r2.completed.length).toBe(1);
    expect(r2.stats.activeDeals).toBeUndefined();
    expect(r2.stats.lifetimeDeals).toBe(125);
  });

  test("tickDeals expires past deadline + drops happiness", () => {
    const deal: ActiveDeal = {
      id: "d1",
      name: "Late",
      requirements: [{ action: "work", count: 5 }],
      deadline: 50,
      started: 0,
      progress: { work: 1 },
      reward: 30,
    };
    const stats = baseStats({ activeDeals: [deal], happiness: 50 });
    const result = tickDeals(stats, null, 100);
    expect(result.expired.length).toBe(1);
    expect(result.stats.happiness).toBe(40);
    expect(result.stats.activeDeals).toBeUndefined();
  });

  test("tickDeals never increases lifetimeDeals on expiration", () => {
    const deal: ActiveDeal = {
      id: "d1",
      name: "Late",
      requirements: [{ action: "work", count: 5 }],
      deadline: 50,
      started: 0,
      progress: {},
      reward: 30,
    };
    const stats = baseStats({ activeDeals: [deal], lifetimeDeals: 100 });
    const result = tickDeals(stats, null, 100);
    expect(result.stats.lifetimeDeals).toBe(100);
  });

  test("tickDeals fails expired deal before same-tick completion", () => {
    const deal: ActiveDeal = {
      id: "d1",
      name: "Late close",
      requirements: [{ action: "work", count: 1 }],
      deadline: 50,
      started: 0,
      progress: {},
      reward: 30,
    };
    const result = tickDeals(baseStats({ activeDeals: [deal] }), "work", 50);
    expect(result.expired).toHaveLength(1);
    expect(result.completed).toHaveLength(0);
    expect(result.stats.lifetimeDeals).toBe(100);
  });

  test("formatDeal renders progress + remaining", () => {
    const deal: ActiveDeal = {
      id: "d1",
      name: "Acme",
      requirements: [{ action: "work", count: 3 }],
      deadline: 10 * 60_000,
      started: 0,
      progress: { work: 1 },
      reward: 50,
    };
    const out = formatDeal(deal, 0);
    expect(out).toContain("Acme");
    expect(out).toContain("work 1/3");
    expect(out).toContain("reward 50");
  });

  test("listDeals returns empty when none", () => {
    expect(listDeals(baseStats())).toEqual([]);
  });
});
