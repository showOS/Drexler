import type { PetStats } from "./petState.ts";

export type EventKind =
  | "pitch"
  | "takeover"
  | "coffee_machine"
  | "audit"
  | "mentor"
  | "comp_committee";

export type StatKey = "hunger" | "happiness" | "energy" | "deals";

export interface EventChoice {
  readonly key: "1" | "2" | "3";
  readonly label: string;
  readonly delta: Partial<Record<StatKey, number>>;
  readonly outcome: string;
}

export interface EventTemplate {
  readonly kind: EventKind;
  readonly prompt: string;
  readonly choices: ReadonlyArray<EventChoice>;
}

export interface PetEvent {
  readonly id: string;
  readonly kind: EventKind;
  readonly prompt: string;
  readonly choices: ReadonlyArray<EventChoice>;
  readonly expiresAt: number;
  readonly spawnedAt: number;
}

export const EVENT_WINDOW_MS = 30_000;
export const EVENT_MIN_GAP_MS = 6 * 60_000;
export const EVENT_MAX_GAP_MS = 18 * 60_000;
export const EVENT_DELTA_LIMIT = 30;

// Each event has 2–3 mutually-exclusive responses. Deltas are bounded to
// ±30 per stat (V42) and the final stats are clamped [0,100] downstream
// (V25). Outcomes lean satirical — Drexler is melodramatic about pitch
// meetings.
export const EVENT_POOL: ReadonlyArray<EventTemplate> = [
  {
    kind: "pitch",
    prompt: "Pitch deck for Acme due in 30s. Drexler asks for direction.",
    choices: [
      {
        key: "1",
        label: "Hard close it",
        delta: { deals: 20, energy: -10, happiness: 5 },
        outcome: "Drexler closes the room. Deck applauded.",
      },
      {
        key: "2",
        label: "Soft deflect",
        delta: { happiness: 5, deals: 5 },
        outcome: "Drexler deflects with corporate jujitsu. Deal half-baked but alive.",
      },
      {
        key: "3",
        label: "Walk out",
        delta: { happiness: -15, energy: 10 },
        outcome: "Drexler walks. Power move; reputation: undecided.",
      },
    ],
  },
  {
    kind: "takeover",
    prompt: "Hostile takeover bid landed in inbox. Defend, sell, or stall?",
    choices: [
      {
        key: "1",
        label: "Defend",
        delta: { deals: 10, happiness: 10, energy: -15 },
        outcome: "Drexler invokes poison pill. Board nods.",
      },
      {
        key: "2",
        label: "Sell",
        delta: { deals: 25, happiness: -10 },
        outcome: "Drexler accepts the offer. Bank account fat, soul lighter.",
      },
      {
        key: "3",
        label: "Stall",
        delta: { happiness: -5, energy: -5 },
        outcome: "Drexler stalls in counsel. Nobody wins, nobody loses.",
      },
    ],
  },
  {
    kind: "coffee_machine",
    prompt: "Coffee machine broke. Office productivity in jeopardy.",
    choices: [
      {
        key: "1",
        label: "Fix it personally",
        delta: { energy: -10, happiness: 15, deals: 5 },
        outcome: "Drexler diagnoses gasket failure. Hero status earned.",
      },
      {
        key: "2",
        label: "Order expensive new one",
        delta: { deals: -15, happiness: 20 },
        outcome: "Drexler signs PO for industrial espresso rig. Morale: euphoric.",
      },
    ],
  },
  {
    kind: "audit",
    prompt: "Surprise audit underway. Compliance memo demanded.",
    choices: [
      {
        key: "1",
        label: "Cooperate fully",
        delta: { happiness: -5, deals: 10, energy: -10 },
        outcome: "Drexler hands over everything. Auditor leaves yawning.",
      },
      {
        key: "2",
        label: "Lawyer up",
        delta: { happiness: 5, energy: -15 },
        outcome: "Drexler invokes counsel. Audit indefinitely paused.",
      },
      {
        key: "3",
        label: "Misplace files",
        delta: { happiness: 10, deals: -20 },
        outcome: "Drexler claims the records were 'reorganized'. Risky.",
      },
    ],
  },
  {
    kind: "mentor",
    prompt: "Junior associate begs Drexler for mentorship.",
    choices: [
      {
        key: "1",
        label: "Take them under wing",
        delta: { happiness: 15, energy: -10, deals: 5 },
        outcome: "Drexler delivers 90-minute monologue on closing. Associate enlightened.",
      },
      {
        key: "2",
        label: "Delegate to HR",
        delta: { happiness: -5, deals: 5 },
        outcome: "Drexler punts. HR sends a PowerPoint.",
      },
    ],
  },
  {
    kind: "comp_committee",
    prompt: "Compensation committee wants Drexler's bonus rationale.",
    choices: [
      {
        key: "1",
        label: "Cite deal record",
        delta: { deals: 15, happiness: 10 },
        outcome: "Drexler enumerates closures. Committee approves overpayment.",
      },
      {
        key: "2",
        label: "Demand more",
        delta: { deals: 25, happiness: -15, energy: -5 },
        outcome: "Drexler ups the ask. Committee shaken but compliant.",
      },
      {
        key: "3",
        label: "Decline bonus",
        delta: { happiness: -10, energy: 10 },
        outcome: "Drexler waves off the bonus. Tactical humility.",
      },
    ],
  },
];

export interface EventScheduler {
  pickEvent: () => EventTemplate;
  pickGap: () => number;
}

export function defaultScheduler(rng: () => number = Math.random): EventScheduler {
  return {
    pickEvent: () => {
      const idx = Math.min(EVENT_POOL.length - 1, Math.floor(rng() * EVENT_POOL.length));
      return EVENT_POOL[idx]!;
    },
    pickGap: () => {
      const span = EVENT_MAX_GAP_MS - EVENT_MIN_GAP_MS;
      return EVENT_MIN_GAP_MS + Math.floor(rng() * span);
    },
  };
}

export function spawnEvent(now: number, scheduler: EventScheduler): PetEvent {
  const template = scheduler.pickEvent();
  return {
    id: `evt_${now.toString(36)}_${template.kind}`,
    kind: template.kind,
    prompt: template.prompt,
    choices: template.choices,
    expiresAt: now + EVENT_WINDOW_MS,
    spawnedAt: now,
  };
}

function clampDelta(delta: number): number {
  if (delta > EVENT_DELTA_LIMIT) return EVENT_DELTA_LIMIT;
  if (delta < -EVENT_DELTA_LIMIT) return -EVENT_DELTA_LIMIT;
  return delta;
}

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export interface EventResolution {
  stats: PetStats;
  message: string;
}

export function applyEventChoice(
  stats: PetStats,
  event: PetEvent,
  choiceKey: string,
  now: number = Date.now(),
): EventResolution | null {
  if (now > event.expiresAt) return null;
  const choice = event.choices.find((c) => c.key === choiceKey);
  if (!choice) return null;
  const next: PetStats = { ...stats };
  for (const [statKey, delta] of Object.entries(choice.delta)) {
    if (typeof delta !== "number") continue;
    const key = statKey as StatKey;
    next[key] = clampStat(stats[key] + clampDelta(delta));
  }
  return { stats: next, message: choice.outcome };
}

export function applyEventCancel(stats: PetStats): EventResolution {
  return {
    stats: { ...stats, happiness: clampStat(stats.happiness - 5) },
    message: "Drexler hits ESC. Mood dips slightly.",
  };
}

export function applyEventExpire(stats: PetStats): EventResolution {
  return {
    stats,
    message: "Event window closed. Drexler files away the moment.",
  };
}

export function isEventExpired(event: PetEvent, now: number = Date.now()): boolean {
  return now > event.expiresAt;
}
