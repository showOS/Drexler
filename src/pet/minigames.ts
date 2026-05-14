import type { PetStats } from "./petState.ts";

export const PITCH_COOLDOWN_MS = 5 * 60_000;
export const NEGOTIATE_COOLDOWN_MS = 5 * 60_000;
export const PITCH_BAR_LEN = 8;
export const PITCH_FRAME_MS = 200;
export const NEGOTIATE_WINDOW_MS = 30_000;

const BAR_CHARS = " ▁▂▃▄▅▆▇█";

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function elapsedSince(now: number, stamp: number | undefined): number {
  if (typeof stamp !== "number" || !Number.isFinite(stamp)) return Number.POSITIVE_INFINITY;
  const e = now - stamp;
  return e < 0 ? Number.POSITIVE_INFINITY : e;
}

// ---- /pitch ----

export interface PitchStartOutcome {
  ok: boolean;
  reason?: "cooldown";
  remainingMs?: number;
  message: string;
}

export function canStartPitch(stats: PetStats, now: number = Date.now()): PitchStartOutcome {
  const e = elapsedSince(now, stats.minigame?.lastPitchAt);
  if (e < PITCH_COOLDOWN_MS) {
    const remainingMs = PITCH_COOLDOWN_MS - e;
    return {
      ok: false,
      reason: "cooldown",
      remainingMs,
      message: `Drexler still warming up. Pitch unlocks in ${Math.ceil(remainingMs / 1000)}s.`,
    };
  }
  return { ok: true, message: "Pitch deck loaded. Press Enter at the peak." };
}

export function pitchBarChar(frame: number): string {
  return BAR_CHARS[(frame % PITCH_BAR_LEN) + 1] ?? BAR_CHARS[1]!;
}

export function pitchFrameFor(elapsedMs: number): number {
  const frames = Math.floor(Math.max(0, elapsedMs) / PITCH_FRAME_MS);
  return frames;
}

export interface PitchResolution {
  hit: boolean;
  bar: string;
  stats: PetStats;
  message: string;
}

// Hit window: frame index mod 8 in [6, 7] (peaks of bar). Stamps
// `lastPitchAt` so cooldown enforced on next attempt.
export function resolvePitch(stats: PetStats, startedAt: number, pressAt: number): PitchResolution {
  const frame = pitchFrameFor(pressAt - startedAt);
  const pos = frame % PITCH_BAR_LEN;
  const hit = pos === 6 || pos === 7;
  const bar = pitchBarChar(frame);
  const minigame = { ...(stats.minigame ?? {}), lastPitchAt: pressAt };
  let next: PetStats = { ...stats, minigame };
  if (hit) {
    next = {
      ...next,
      happiness: clampStat(next.happiness + 20),
      deals: clampStat(next.deals + 15),
    };
  } else {
    next = { ...next, happiness: clampStat(next.happiness - 5) };
  }
  return {
    hit,
    bar,
    stats: next,
    message: hit
      ? `Drexler nails the pitch at peak ${bar}. Room erupts.`
      : `Drexler mistimes the pitch at ${bar}. Awkward silence.`,
  };
}

// ---- /negotiate ----

export type NegotiateChoiceTone = "neutral" | "bold" | "aggressive";

export interface NegotiateChoice {
  readonly key: "1" | "2" | "3";
  readonly tone: NegotiateChoiceTone;
  readonly label: string;
  readonly delta: Partial<Record<"happiness" | "energy" | "deals", number>>;
  readonly outcome: string;
}

export interface NegotiateScenario {
  readonly id: string;
  readonly prompt: string;
  readonly choices: ReadonlyArray<NegotiateChoice>;
}

export const NEGOTIATE_POOL: ReadonlyArray<NegotiateScenario> = [
  {
    id: "lowball_offer",
    prompt: "Counterparty lowballs Drexler by 30%. Respond?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Counter with revised math",
        delta: { deals: 8, happiness: 4 },
        outcome: "Drexler walks them through the model. Compromise reached.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Reject outright",
        delta: { deals: 14, happiness: 6 },
        outcome: "Drexler folds the deck and exits. They come back stronger.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Threaten to walk + leak",
        delta: { deals: 18, happiness: -8 },
        outcome: "Drexler implies a press release. Numbers move fast.",
      },
    ],
  },
  {
    id: "exclusivity_demand",
    prompt: "Counterparty demands 60-day exclusivity. Drexler?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Accept 14-day exclusivity",
        delta: { deals: 6 },
        outcome: "Drexler grants a short window. Other suitors keep warm.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Demand mutual exclusivity",
        delta: { deals: 12, happiness: 4 },
        outcome: "Drexler flips the table. They concede.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Refuse and run an auction",
        delta: { deals: 16, energy: -8 },
        outcome: "Drexler runs a banker auction. Tiring but lucrative.",
      },
    ],
  },
  {
    id: "earnout_dispute",
    prompt: "Earnout milestones are contested. Where does Drexler land?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Split the difference",
        delta: { deals: 10 },
        outcome: "Drexler splits the milestone. Both sides shrug, sign.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Hold the line",
        delta: { deals: 12, happiness: 4 },
        outcome: "Drexler refuses to budge. Counterparty caves.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Add a clawback",
        delta: { deals: 14, happiness: -4 },
        outcome: "Drexler tacks on a clawback clause. Eyebrows raised.",
      },
    ],
  },
  {
    id: "indemnity_basket",
    prompt: "Indemnity basket is too small. Drexler pushes back?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Raise the cap modestly",
        delta: { deals: 6, energy: -4 },
        outcome: "Drexler tweaks the cap. Counsel approves.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Tie cap to revenue multiple",
        delta: { deals: 12 },
        outcome: "Drexler indexes it. Smart move.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Refuse cap entirely",
        delta: { deals: 16, happiness: -10 },
        outcome: "Drexler scraps the cap. Lawyers age visibly.",
      },
    ],
  },
  {
    id: "press_release",
    prompt: "Counterparty wants joint press release tomorrow. Drexler?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Sign the boilerplate",
        delta: { happiness: 4 },
        outcome: "Drexler signs. Predictable copy.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Insist on quote attribution",
        delta: { happiness: 8, deals: 4 },
        outcome: "Drexler gets a quote. PR delighted.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Demand bylined op-ed",
        delta: { happiness: 10, energy: -8 },
        outcome: "Drexler files a 1500-word op-ed by 10am. Influence multiplied.",
      },
    ],
  },
  {
    id: "no_shop",
    prompt: "Counterparty pushes a no-shop. Drexler?",
    choices: [
      {
        key: "1",
        tone: "neutral",
        label: "Carve out fiduciary out",
        delta: { deals: 8 },
        outcome: "Drexler carves out fiduciary protections. Standard play.",
      },
      {
        key: "2",
        tone: "bold",
        label: "Insist on a go-shop",
        delta: { deals: 14 },
        outcome: "Drexler keeps the auction window open.",
      },
      {
        key: "3",
        tone: "aggressive",
        label: "Drop the deal mid-call",
        delta: { deals: -10, happiness: -6 },
        outcome: "Drexler kills the deal live on the call. Risky.",
      },
    ],
  },
];

export interface NegotiateOpenOutcome {
  ok: boolean;
  reason?: "cooldown";
  remainingMs?: number;
  scenario?: NegotiateScenario;
  message: string;
}

export function openNegotiate(
  stats: PetStats,
  now: number = Date.now(),
  rng: () => number = Math.random,
): NegotiateOpenOutcome {
  const e = elapsedSince(now, stats.minigame?.lastNegotiateAt);
  if (e < NEGOTIATE_COOLDOWN_MS) {
    const remainingMs = NEGOTIATE_COOLDOWN_MS - e;
    return {
      ok: false,
      reason: "cooldown",
      remainingMs,
      message: `Drexler still in last negotiation. Try again in ${Math.ceil(remainingMs / 1000)}s.`,
    };
  }
  const idx = Math.min(NEGOTIATE_POOL.length - 1, Math.floor(rng() * NEGOTIATE_POOL.length));
  const scenario = NEGOTIATE_POOL[idx]!;
  return {
    ok: true,
    scenario,
    message: `Negotiate: ${scenario.prompt}`,
  };
}

export function gateNegotiateChoice(
  stats: PetStats,
  choice: NegotiateChoice,
): { allowed: boolean; reason?: string } {
  if (choice.tone === "bold" && stats.happiness < 60) {
    return { allowed: false, reason: "Bold lines need happiness ≥ 60." };
  }
  if (choice.tone === "aggressive" && stats.energy < 60) {
    return { allowed: false, reason: "Aggressive lines need energy ≥ 60." };
  }
  return { allowed: true };
}

export interface NegotiateResolution {
  stats: PetStats;
  message: string;
}

export function resolveNegotiate(
  stats: PetStats,
  scenario: NegotiateScenario,
  choiceKey: string,
  now: number = Date.now(),
): NegotiateResolution | null {
  const choice = scenario.choices.find((c) => c.key === choiceKey);
  if (!choice) return null;
  const gate = gateNegotiateChoice(stats, choice);
  if (!gate.allowed) {
    return { stats, message: gate.reason ?? "Choice unavailable." };
  }
  let next: PetStats = { ...stats };
  for (const [key, delta] of Object.entries(choice.delta)) {
    if (typeof delta !== "number") continue;
    const k = key as "happiness" | "energy" | "deals";
    next[k] = clampStat(next[k] + delta);
  }
  next = {
    ...next,
    minigame: { ...(next.minigame ?? {}), lastNegotiateAt: now },
  };
  return { stats: next, message: choice.outcome };
}
