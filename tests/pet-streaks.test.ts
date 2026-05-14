import { describe, expect, test } from "bun:test";
import {
  STREAK_MILESTONE_REWARD,
  applyChallengeReward,
  bumpDailyChallenge,
  bumpStreakForAction,
  ensureDailyChallenge,
  renderChallenge,
  renderStreak,
} from "../src/pet/streaks.ts";
import type { PetStats } from "../src/pet/petState.ts";

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

function localNoon(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

describe("streaks", () => {
  test("first action of the day bumps to count 1", () => {
    const r = bumpStreakForAction(baseStats(), localNoon(2026, 5, 13));
    expect(r.bumped).toBe(true);
    expect(r.stats.streak?.count).toBe(1);
    expect(r.stats.streak?.bestCount).toBe(1);
  });

  test("same-day repeat does not bump (V53)", () => {
    const r1 = bumpStreakForAction(baseStats(), localNoon(2026, 5, 13));
    const r2 = bumpStreakForAction(r1.stats, localNoon(2026, 5, 13));
    expect(r2.bumped).toBe(false);
    expect(r2.stats.streak?.count).toBe(1);
  });

  test("consecutive day continues streak", () => {
    const r1 = bumpStreakForAction(baseStats(), localNoon(2026, 5, 13));
    const r2 = bumpStreakForAction(r1.stats, localNoon(2026, 5, 14));
    expect(r2.stats.streak?.count).toBe(2);
  });

  test("skip a day resets count, keeps best (V53)", () => {
    let stats = baseStats();
    stats = bumpStreakForAction(stats, localNoon(2026, 5, 13)).stats;
    stats = bumpStreakForAction(stats, localNoon(2026, 5, 14)).stats;
    const r = bumpStreakForAction(stats, localNoon(2026, 5, 16));
    expect(r.reset).toBe(true);
    expect(r.stats.streak?.count).toBe(1);
    expect(r.stats.streak?.bestCount).toBe(2);
  });

  test("milestone reward fires at 3-day step and only once", () => {
    let stats = baseStats();
    for (let i = 0; i < 3; i++) {
      stats = bumpStreakForAction(stats, localNoon(2026, 5, 13 + i)).stats;
    }
    expect(stats.lifetimeDeals).toBe(100 + STREAK_MILESTONE_REWARD);
    // Streak reaches 4 days — no second milestone yet.
    const r4 = bumpStreakForAction(stats, localNoon(2026, 5, 16));
    expect(r4.milestone).toBe(false);
  });

  test("ensureDailyChallenge rolls once per day", () => {
    const r1 = ensureDailyChallenge(baseStats(), localNoon(2026, 5, 13), () => 0);
    expect(r1.freshly).toBe(true);
    const r2 = ensureDailyChallenge(r1.stats, localNoon(2026, 5, 13));
    expect(r2.freshly).toBe(false);
    expect(r2.stats).toBe(r1.stats);
  });

  test("bumpDailyChallenge advances progress + completes once", () => {
    const seeded = ensureDailyChallenge(baseStats(), localNoon(2026, 5, 13), () => 0).stats;
    // Seed deterministically picks first kind = close_deals_2 (target 2).
    expect(seeded.dailyChallenge?.kind).toBe("close_deals_2");
    const r1 = bumpDailyChallenge(seeded, "close_deals_2", 1, localNoon(2026, 5, 13));
    expect(r1.completedNow).toBe(false);
    const r2 = bumpDailyChallenge(r1.stats, "close_deals_2", 1, localNoon(2026, 5, 13));
    expect(r2.completedNow).toBe(true);
    expect(r2.stats.dailyChallenge?.rewarded).toBe(true);
    const r3 = bumpDailyChallenge(r2.stats, "close_deals_2", 1, localNoon(2026, 5, 13));
    expect(r3.completedNow).toBe(false);
  });

  test("applyChallengeReward adds deals + charter only when rewarded", () => {
    const seeded = ensureDailyChallenge(
      baseStats({ deals: 40 }),
      localNoon(2026, 5, 13),
      () => 0,
    ).stats;
    const unrewarded = applyChallengeReward(seeded);
    expect(unrewarded.deals).toBe(40);
    const rewarded = { ...seeded, dailyChallenge: { ...seeded.dailyChallenge!, rewarded: true } };
    const after = applyChallengeReward(rewarded);
    expect(after.deals).toBe(65);
    expect(after.inventory?.charter).toBe(1);
  });

  test("rendering helpers produce strings", () => {
    expect(renderStreak(baseStats())).toContain("No active");
    const seeded = ensureDailyChallenge(baseStats(), localNoon(2026, 5, 13), () => 0).stats;
    expect(renderChallenge(seeded)).toContain("Daily challenge");
  });
});
