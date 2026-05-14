// Micro-bench for the pet-mode hot path. Not a hard regression gate
// (CI variance is high) but a smoke check that the composed multiplier
// + reducer math stays under a reasonable budget on a developer box.
// Skips when `DREXLER_PERF=1` is unset so CI stays green.
import { describe, expect, test } from "bun:test";
import {
  accrueLifetimeDeals,
  appendActionHistory,
  applyDecay,
  applyWork,
  sessionDecayMultiplier,
  stampAction,
  type PetStats,
} from "../src/pet/petState.ts";
import { tickDeals } from "../src/pet/deals.ts";
import { detectSynergy } from "../src/pet/synergy.ts";
import { archetypeMultipliers } from "../src/pet/archetype.ts";
import { perkDecayMultiplier } from "../src/pet/perks.ts";
import { worldDecayMultiplier } from "../src/pet/world.ts";

function compose(stats: PetStats, now: number): number {
  return Math.min(
    1,
    sessionDecayMultiplier(stats, now) *
      perkDecayMultiplier(stats) *
      worldDecayMultiplier(stats, now) *
      archetypeMultipliers(stats).decay,
  );
}

function baseStats(): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 500,
    perks: ["slow_decay", "quick_recovery", "rainmaker", "pipeline"],
    archetype: "closer",
    actionHistory: [{ action: "work", at: Date.now() }],
    worldEvent: {
      kind: "ipo_mania",
      startedAt: Date.now(),
      expiresAt: Date.now() + 60 * 60_000,
    },
    activeDeals: [
      {
        id: "d1",
        name: "Acme",
        requirements: [{ action: "work", count: 3 }],
        deadline: Date.now() + 60 * 60_000,
        started: Date.now(),
        progress: { work: 1 },
        reward: 50,
      },
      {
        id: "d2",
        name: "Quarterly",
        requirements: [{ action: "work", count: 2 }],
        deadline: Date.now() + 60 * 60_000,
        started: Date.now(),
        progress: {},
        reward: 35,
      },
    ],
  };
}

function actionStep(stats: PetStats, now: number): PetStats {
  const mult = compose(stats, now);
  let next = applyDecay(stats, now, mult);
  next = applyWork(next);
  next = stampAction(next, "work", now);
  next = accrueLifetimeDeals(next, "work");
  next = appendActionHistory(next, "work", now);
  const t = tickDeals(next, "work", now);
  next = t.stats;
  const s = detectSynergy(next, now);
  return s.stats;
}

describe("pet action perf bench (T46)", () => {
  test("applyPetAction-equivalent stays under 1ms p99", () => {
    if (process.env.DREXLER_PERF !== "1") {
      // Smoke run only — full perf gate opt-in.
      const stats = baseStats();
      const out = actionStep(stats, Date.now());
      expect(out.lifetimeDeals).toBeGreaterThanOrEqual(500);
      return;
    }
    const stats = baseStats();
    const samples: number[] = [];
    const N = 500;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      actionStep(stats, Date.now() + i);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(N * 0.5)]!;
    const p99 = samples[Math.floor(N * 0.99)]!;
    const max = samples[N - 1]!;
    process.stderr.write(
      `pet action bench p50=${p50.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms\n`,
    );
    expect(p99).toBeLessThan(1);
  });
});
