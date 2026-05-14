import { describe, expect, test } from "bun:test";
import {
  EVENT_POOL,
  EVENT_WINDOW_MS,
  applyEventCancel,
  applyEventChoice,
  applyEventExpire,
  defaultScheduler,
  isEventExpired,
  spawnEvent,
} from "../src/pet/events.ts";
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

describe("pet events", () => {
  test("event pool is well-formed", () => {
    expect(EVENT_POOL.length).toBeGreaterThanOrEqual(3);
    for (const tmpl of EVENT_POOL) {
      expect(tmpl.kind).toBeDefined();
      expect(tmpl.choices.length).toBeGreaterThanOrEqual(2);
      expect(tmpl.choices.length).toBeLessThanOrEqual(3);
      const keys = new Set(tmpl.choices.map((c) => c.key));
      expect(keys.size).toBe(tmpl.choices.length);
    }
  });

  test("spawnEvent assigns 30s window and stamp", () => {
    const scheduler = defaultScheduler(fixedRng([0]));
    const event = spawnEvent(1_000_000, scheduler);
    expect(event.expiresAt - event.spawnedAt).toBe(EVENT_WINDOW_MS);
    expect(event.spawnedAt).toBe(1_000_000);
    expect(event.choices.length).toBeGreaterThanOrEqual(2);
  });

  test("applyEventChoice applies delta and clamps stat ceiling", () => {
    const scheduler = defaultScheduler(fixedRng([0]));
    const event = spawnEvent(1_000, scheduler);
    const stats = baseStats({ deals: 95 });
    const result = applyEventChoice(stats, event, "1", 2_000);
    expect(result).not.toBeNull();
    expect(result?.stats.deals).toBeLessThanOrEqual(100);
    expect(result?.stats.deals).toBeGreaterThanOrEqual(0);
  });

  test("applyEventChoice clamps delta to ±30", () => {
    const stats = baseStats({ deals: 0 });
    // Craft a synthetic event whose delta exceeds +30 — engine must clamp.
    const event = {
      id: "synthetic",
      kind: "pitch" as const,
      prompt: "test",
      choices: [
        {
          key: "1" as const,
          label: "big",
          delta: { deals: 90 },
          outcome: "ok",
        },
      ],
      expiresAt: 10_000,
      spawnedAt: 0,
    };
    const result = applyEventChoice(stats, event, "1", 100);
    expect(result?.stats.deals).toBeLessThanOrEqual(30);
  });

  test("applyEventChoice rejects unknown choice", () => {
    const scheduler = defaultScheduler(fixedRng([0]));
    const event = spawnEvent(1_000, scheduler);
    const stats = baseStats();
    const result = applyEventChoice(stats, event, "9", 2_000);
    expect(result).toBeNull();
  });

  test("applyEventChoice rejects past window", () => {
    const scheduler = defaultScheduler(fixedRng([0]));
    const event = spawnEvent(1_000, scheduler);
    const stats = baseStats();
    const result = applyEventChoice(stats, event, "1", 1_000 + EVENT_WINDOW_MS + 1);
    expect(result).toBeNull();
  });

  test("applyEventCancel drops happiness by 5", () => {
    const stats = baseStats({ happiness: 40 });
    const { stats: next } = applyEventCancel(stats);
    expect(next.happiness).toBe(35);
  });

  test("applyEventCancel never goes below 0", () => {
    const stats = baseStats({ happiness: 2 });
    const { stats: next } = applyEventCancel(stats);
    expect(next.happiness).toBe(0);
  });

  test("applyEventExpire returns same identity", () => {
    const stats = baseStats();
    const { stats: next, message } = applyEventExpire(stats);
    expect(next).toBe(stats);
    expect(message).toMatch(/closed/i);
  });

  test("isEventExpired honors window", () => {
    const scheduler = defaultScheduler(fixedRng([0]));
    const event = spawnEvent(0, scheduler);
    expect(isEventExpired(event, 1_000)).toBe(false);
    expect(isEventExpired(event, EVENT_WINDOW_MS + 1)).toBe(true);
  });

  test("scheduler gap stays within bounds", () => {
    const scheduler = defaultScheduler(fixedRng([0, 0.5, 0.999]));
    const g1 = scheduler.pickGap();
    const g2 = scheduler.pickGap();
    const g3 = scheduler.pickGap();
    for (const g of [g1, g2, g3]) {
      expect(g).toBeGreaterThanOrEqual(6 * 60_000);
      expect(g).toBeLessThanOrEqual(18 * 60_000);
    }
  });
});
