import { describe, expect, test } from "bun:test";
import {
  NEGOTIATE_POOL,
  PITCH_BAR_LEN,
  PITCH_COOLDOWN_MS,
  canStartPitch,
  gateNegotiateChoice,
  openNegotiate,
  pitchBarChar,
  pitchFrameFor,
  resolveNegotiate,
  resolvePitch,
} from "../src/pet/minigames.ts";
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

describe("pitch mini-game", () => {
  test("canStartPitch respects cooldown (V57)", () => {
    const stats = baseStats({ minigame: { lastPitchAt: 1_000 } });
    const r = canStartPitch(stats, 1_500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cooldown");
  });

  test("canStartPitch true when cooldown elapsed", () => {
    const stats = baseStats({ minigame: { lastPitchAt: 1_000 } });
    const r = canStartPitch(stats, 1_000 + PITCH_COOLDOWN_MS + 1);
    expect(r.ok).toBe(true);
  });

  test("pitchFrameFor advances by 200ms each frame", () => {
    expect(pitchFrameFor(0)).toBe(0);
    expect(pitchFrameFor(200)).toBe(1);
    expect(pitchFrameFor(1_000)).toBe(5);
  });

  test("resolvePitch hits when frame index is at peak (6 or 7)", () => {
    // 6 * 200ms = 1200
    const r = resolvePitch(baseStats(), 0, 1200);
    expect(r.hit).toBe(true);
    expect(r.stats.happiness).toBeGreaterThan(50);
  });

  test("resolvePitch misses outside peak band", () => {
    const r = resolvePitch(baseStats(), 0, 0);
    expect(r.hit).toBe(false);
    expect(r.stats.happiness).toBeLessThan(50);
  });

  test("pitchBarChar maps frame to BAR_CHARS", () => {
    expect(pitchBarChar(0).length).toBeGreaterThan(0);
    expect(pitchBarChar(PITCH_BAR_LEN).length).toBeGreaterThan(0);
  });
});

describe("negotiate mini-game", () => {
  test("openNegotiate respects cooldown", () => {
    const stats = baseStats({ minigame: { lastNegotiateAt: 1_000 } });
    const r = openNegotiate(stats, 1_500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cooldown");
  });

  test("openNegotiate returns a scenario", () => {
    const r = openNegotiate(baseStats(), 0, () => 0);
    expect(r.ok).toBe(true);
    expect(r.scenario?.id).toBe(NEGOTIATE_POOL[0]!.id);
  });

  test("gateNegotiateChoice blocks bold + aggressive under thresholds", () => {
    const scenario = NEGOTIATE_POOL[0]!;
    const bold = scenario.choices.find((c) => c.tone === "bold")!;
    const aggressive = scenario.choices.find((c) => c.tone === "aggressive")!;
    expect(gateNegotiateChoice(baseStats({ happiness: 50 }), bold).allowed).toBe(false);
    expect(gateNegotiateChoice(baseStats({ happiness: 60 }), bold).allowed).toBe(true);
    expect(gateNegotiateChoice(baseStats({ energy: 50 }), aggressive).allowed).toBe(false);
    expect(gateNegotiateChoice(baseStats({ energy: 60 }), aggressive).allowed).toBe(true);
  });

  test("resolveNegotiate applies stat delta and stamps timer", () => {
    const scenario = NEGOTIATE_POOL[0]!;
    const stats = baseStats({ happiness: 80, energy: 80 });
    const r = resolveNegotiate(stats, scenario, "1", 1_000);
    expect(r).not.toBeNull();
    expect(r!.stats.minigame?.lastNegotiateAt).toBe(1_000);
    expect(r!.stats.deals).toBeGreaterThan(50);
  });

  test("resolveNegotiate refuses unknown choice", () => {
    const scenario = NEGOTIATE_POOL[0]!;
    const r = resolveNegotiate(baseStats(), scenario, "9", 1_000);
    expect(r).toBeNull();
  });

  test("resolveNegotiate emits gate message when locked-out", () => {
    const scenario = NEGOTIATE_POOL[0]!;
    const r = resolveNegotiate(baseStats({ happiness: 30 }), scenario, "2", 0);
    expect(r).not.toBeNull();
    expect(r!.stats).toEqual(baseStats({ happiness: 30 }));
    expect(r!.message).toMatch(/happiness/i);
  });
});
