import { describe, expect, test } from "bun:test";
import {
  bumpAgenda,
  bumpAgendaForAction,
  ensureAgenda,
  generateAgenda,
  renderAgenda,
} from "../src/pet/agenda.ts";
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

describe("pet agenda", () => {
  test("generates three daily mandates and one weekly mandate", () => {
    const agenda = generateAgenda(baseStats(), Date.parse("2026-05-18T17:00:00Z"), () => 0);
    expect(agenda.daily).toHaveLength(3);
    expect(agenda.weekly.target).toBeGreaterThan(0);
  });

  test("does not require trade outside market hours", () => {
    const agenda = generateAgenda(baseStats(), Date.parse("2026-05-17T17:00:00Z"), () => 0.99);
    expect(agenda.daily.some((i) => i.kind === "win_trade")).toBe(false);
  });

  test("rolls daily and weekly records independently", () => {
    const monday = Date.parse("2026-05-18T17:00:00Z");
    const tuesday = Date.parse("2026-05-19T17:00:00Z");
    const nextWeek = Date.parse("2026-05-25T17:00:00Z");
    const first = ensureAgenda(baseStats(), monday, () => 0).stats;
    const second = ensureAgenda(first, tuesday, () => 0.5);
    expect(second.dailyFresh).toBe(true);
    expect(second.weeklyFresh).toBe(false);
    const third = ensureAgenda(second.stats, nextWeek, () => 0.5);
    expect(third.weeklyFresh).toBe(true);
  });

  test("advances progress and applies each reward once", () => {
    const stats = ensureAgenda(baseStats(), Date.parse("2026-05-18T17:00:00Z"), () => 0).stats;
    const first = bumpAgendaForAction(stats, "feed", Date.parse("2026-05-18T17:01:00Z"));
    const rewardedLifetime = first.stats.lifetimeDeals;
    const second = bumpAgenda(first.stats, "feed", 1, Date.parse("2026-05-18T17:02:00Z"));
    expect(first.completed.length).toBeGreaterThan(0);
    expect(second.completed).toHaveLength(0);
    expect(second.stats.lifetimeDeals).toBe(rewardedLifetime);
  });

  test("renders agenda with active deal and next action hints", () => {
    const stats = ensureAgenda(
      baseStats({
        activeDeals: [
          {
            id: "d1",
            name: "Acme",
            requirements: [{ action: "work", count: 1 }],
            deadline: Date.parse("2026-05-19T17:00:00Z"),
            started: Date.parse("2026-05-18T17:00:00Z"),
            progress: {},
            reward: 10,
          },
        ],
      }),
      Date.parse("2026-05-18T17:00:00Z"),
      () => 0,
    ).stats;
    const out = renderAgenda(stats, Date.parse("2026-05-18T17:00:00Z"));
    expect(out).toContain("Agenda");
    expect(out).toContain("Acme");
    expect(out).toContain("Next:");
  });
});
