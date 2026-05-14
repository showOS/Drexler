import type { ActionHistoryEntry, PetActionKey, PetStats } from "./petState.ts";
import { ACTION_HISTORY_LIMIT } from "./petState.ts";

export const SYNERGY_WINDOW_MS = 5 * 60_000;

type StatDelta = Partial<Record<"hunger" | "happiness" | "energy" | "deals", number>>;

export interface SynergyPattern {
  readonly id: string;
  readonly label: string;
  readonly sequence: ReadonlyArray<PetActionKey>;
  readonly delta: StatDelta;
  readonly lifetimeDelta?: number;
}

// Patterns are matched against the LAST N entries in actionHistory. The
// first matching pattern wins, so order matters: list higher-reward
// chains first.
export const SYNERGY_PATTERNS: ReadonlyArray<SynergyPattern> = [
  {
    id: "rainmaker",
    label: "Rainmaker",
    sequence: ["work", "play", "praise"],
    delta: { happiness: 15, energy: 15, deals: 10 },
  },
  {
    id: "grind",
    label: "Grind",
    sequence: ["feed", "work", "work"],
    delta: { deals: 20 },
  },
  {
    id: "promotion_arc",
    label: "Promotion Arc",
    sequence: ["rest", "work", "praise"],
    delta: {},
    lifetimeDelta: 10,
  },
];

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export interface SynergyDetection {
  stats: PetStats;
  matched: SynergyPattern | null;
  message?: string;
}

function lastEntries(history: ReadonlyArray<ActionHistoryEntry>, n: number): ActionHistoryEntry[] {
  if (history.length <= n) return history.slice();
  return history.slice(history.length - n);
}

function patternMatches(
  history: ReadonlyArray<ActionHistoryEntry>,
  pattern: SynergyPattern,
  now: number,
): boolean {
  if (history.length < pattern.sequence.length) return false;
  const tail = lastEntries(history, pattern.sequence.length);
  for (let i = 0; i < pattern.sequence.length; i++) {
    if (tail[i]!.action !== pattern.sequence[i]) return false;
  }
  const first = tail[0]!;
  if (now - first.at > SYNERGY_WINDOW_MS) return false;
  return true;
}

// After detection we clear the consumed entries so the same prefix
// cannot retrigger on the next action. The remaining tail (older
// entries) stay so they could compose into a future combo.
function consumeMatched(
  history: ReadonlyArray<ActionHistoryEntry>,
  pattern: SynergyPattern,
): ActionHistoryEntry[] {
  const keep = history.length - pattern.sequence.length;
  const next = keep > 0 ? history.slice(0, keep) : [];
  while (next.length > ACTION_HISTORY_LIMIT) next.shift();
  return next;
}

export function detectSynergy(stats: PetStats, now: number = Date.now()): SynergyDetection {
  const history = stats.actionHistory ?? [];
  for (const pattern of SYNERGY_PATTERNS) {
    if (!patternMatches(history, pattern, now)) continue;
    const remaining = consumeMatched(history, pattern);
    let next: PetStats = {
      ...stats,
      actionHistory: remaining.length > 0 ? remaining : undefined,
    };
    for (const [statKey, delta] of Object.entries(pattern.delta)) {
      if (typeof delta !== "number") continue;
      const key = statKey as keyof StatDelta;
      next = { ...next, [key]: clampStat((next[key] as number) + delta) };
    }
    if (typeof pattern.lifetimeDelta === "number") {
      const lifetime = typeof next.lifetimeDeals === "number" ? next.lifetimeDeals : next.deals;
      next = { ...next, lifetimeDeals: lifetime + pattern.lifetimeDelta };
    }
    return {
      stats: next,
      matched: pattern,
      message: `SYNERGY: ${pattern.label} unlocked. Bonus applied.`,
    };
  }
  return { stats, matched: null };
}
