import { describe, expect, test } from "bun:test";
import {
  buildReviewSnapshot,
  bumpDealsClosed,
  bumpEventsSurvived,
  ensureReviewCounters,
  evaluateReviewGate,
  formatReview,
  isNewLocalDay,
  markReviewShown,
  startOfLocalDay,
} from "../src/pet/review.ts";
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

function noon(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

describe("daily review", () => {
  test("startOfLocalDay aligns to midnight", () => {
    const d = startOfLocalDay(noon(2026, 5, 13));
    const date = new Date(d);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  test("isNewLocalDay true on first run", () => {
    expect(isNewLocalDay(undefined, noon(2026, 5, 13))).toBe(true);
  });

  test("isNewLocalDay false within same day", () => {
    const ts = noon(2026, 5, 13);
    const morning = new Date(2026, 4, 13, 8, 0, 0, 0).getTime();
    expect(isNewLocalDay(morning, ts)).toBe(false);
  });

  test("isNewLocalDay true after midnight crossing", () => {
    const yesterday = noon(2026, 5, 12);
    const today = noon(2026, 5, 13);
    expect(isNewLocalDay(yesterday, today)).toBe(true);
  });

  test("ensureReviewCounters resets at new local day", () => {
    const yesterdayStats = baseStats({
      reviewCounters: {
        date: "2026-05-12",
        dealsClosed: 7,
        eventsSurvived: 3,
        startHappiness: 70,
        startEnergy: 70,
      },
    });
    const next = ensureReviewCounters(yesterdayStats, noon(2026, 5, 13));
    expect(next.reviewCounters?.date).toBe("2026-05-13");
    expect(next.reviewCounters?.dealsClosed).toBe(0);
  });

  test("bumpDealsClosed / bumpEventsSurvived only mutate when counters exist", () => {
    const noCounters = baseStats();
    expect(bumpDealsClosed(noCounters).reviewCounters).toBeUndefined();
    expect(bumpEventsSurvived(noCounters).reviewCounters).toBeUndefined();
    const seeded = ensureReviewCounters(baseStats(), noon(2026, 5, 13));
    expect(bumpDealsClosed(seeded).reviewCounters?.dealsClosed).toBe(1);
    expect(bumpEventsSurvived(seeded).reviewCounters?.eventsSurvived).toBe(1);
  });

  test("evaluateReviewGate gates on prior activity", () => {
    const noActivity = baseStats();
    expect(evaluateReviewGate(noActivity, noon(2026, 5, 13)).shouldShow).toBe(false);
    const withActivity = baseStats({
      actionHistory: [{ action: "work", at: 1 }],
    });
    expect(evaluateReviewGate(withActivity, noon(2026, 5, 13)).shouldShow).toBe(true);
  });

  test("evaluateReviewGate respects already-shown today", () => {
    const stats = baseStats({
      lastReviewAt: noon(2026, 5, 13) - 60_000,
      actionHistory: [{ action: "work", at: 1 }],
    });
    const gate = evaluateReviewGate(stats, noon(2026, 5, 13));
    expect(gate.shouldShow).toBe(false);
    expect(gate.reason).toBe("already_shown");
  });

  test("buildReviewSnapshot + formatReview are renderable", () => {
    const stats = ensureReviewCounters(baseStats({ happiness: 60, energy: 40 }), noon(2026, 5, 13));
    const snap = buildReviewSnapshot({
      stats: { ...stats, happiness: 75, energy: 30 },
      now: noon(2026, 5, 13),
      oneLinerPick: (lines) => lines[0]!,
    });
    expect(snap.happinessDelta).toBe(15);
    expect(snap.energyDelta).toBe(-10);
    expect(formatReview(snap)).toContain("Daily review");
  });

  test("markReviewShown advances lastReviewAt", () => {
    const stats = baseStats();
    const next = markReviewShown(stats, 42);
    expect(next.lastReviewAt).toBe(42);
  });
});
