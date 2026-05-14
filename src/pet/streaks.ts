import { localDateStamp } from "./trade.ts";
import type { PetStats } from "./petState.ts";

export const STREAK_MILESTONE = 3;
export const STREAK_MILESTONE_REWARD = 10;

export interface StreakRecord {
  lastActiveDate: string;
  count: number;
  bestCount: number;
  milestoneClaimedAt: number;
}

export type DailyChallengeKind =
  | "close_deals_2"
  | "win_trade"
  | "survive_2_events"
  | "synergy_1"
  | "pet_action_10";

export interface DailyChallenge {
  date: string;
  kind: DailyChallengeKind;
  target: number;
  progress: number;
  rewarded: boolean;
}

export const DAILY_CHALLENGE_KINDS: ReadonlyArray<DailyChallengeKind> = [
  "close_deals_2",
  "win_trade",
  "survive_2_events",
  "synergy_1",
  "pet_action_10",
];

const KIND_TARGETS: Record<DailyChallengeKind, number> = {
  close_deals_2: 2,
  win_trade: 1,
  survive_2_events: 2,
  synergy_1: 1,
  pet_action_10: 10,
};

const KIND_LABELS: Record<DailyChallengeKind, string> = {
  close_deals_2: "Close 2 deals",
  win_trade: "Win a /trade",
  survive_2_events: "Handle 2 events",
  synergy_1: "Trigger a synergy combo",
  pet_action_10: "Run 10 pet actions",
};

function streakOf(stats: PetStats): StreakRecord {
  const s = stats.streak;
  if (s && typeof s.lastActiveDate === "string") {
    return {
      lastActiveDate: s.lastActiveDate,
      count: typeof s.count === "number" ? Math.max(0, Math.floor(s.count)) : 0,
      bestCount: typeof s.bestCount === "number" ? Math.max(0, Math.floor(s.bestCount)) : 0,
      milestoneClaimedAt:
        typeof s.milestoneClaimedAt === "number"
          ? Math.max(0, Math.floor(s.milestoneClaimedAt))
          : 0,
    };
  }
  return {
    lastActiveDate: "",
    count: 0,
    bestCount: 0,
    milestoneClaimedAt: 0,
  };
}

function isYesterday(prev: string, today: string): boolean {
  if (!prev) return false;
  const prevDate = new Date(prev + "T12:00:00");
  const todayDate = new Date(today + "T12:00:00");
  const diff = Math.round((todayDate.getTime() - prevDate.getTime()) / 86_400_000);
  return diff === 1;
}

export interface StreakBump {
  stats: PetStats;
  bumped: boolean;
  reset: boolean;
  milestone: boolean;
  rewardLifetime: number;
}

// Called once per action commit. Mutates the streak record at most once
// per local-calendar day (V53). Returns flags so the caller can narrate.
export function bumpStreakForAction(stats: PetStats, now: number = Date.now()): StreakBump {
  const today = localDateStamp(now);
  const streak = streakOf(stats);
  if (streak.lastActiveDate === today) {
    return { stats, bumped: false, reset: false, milestone: false, rewardLifetime: 0 };
  }
  const continuing = isYesterday(streak.lastActiveDate, today);
  const reset = streak.lastActiveDate !== "" && !continuing;
  const nextCount = continuing ? streak.count + 1 : 1;
  const nextBest = Math.max(streak.bestCount, nextCount);
  let rewardLifetime = 0;
  let milestone = false;
  let milestoneClaimedAt = streak.milestoneClaimedAt;
  if (nextBest > streak.milestoneClaimedAt && nextBest % STREAK_MILESTONE === 0) {
    milestone = true;
    rewardLifetime = STREAK_MILESTONE_REWARD;
    milestoneClaimedAt = nextBest;
  }
  const lifetime = typeof stats.lifetimeDeals === "number" ? stats.lifetimeDeals : stats.deals;
  const nextStats: PetStats = {
    ...stats,
    streak: {
      lastActiveDate: today,
      count: nextCount,
      bestCount: nextBest,
      milestoneClaimedAt,
    },
    lifetimeDeals: lifetime + rewardLifetime,
  };
  return { stats: nextStats, bumped: true, reset, milestone, rewardLifetime };
}

export function renderStreak(stats: PetStats): string {
  const streak = streakOf(stats);
  if (streak.count === 0 && streak.bestCount === 0) {
    return "No active streak. Run an action to start.";
  }
  return [
    `Streak — current ${streak.count}d, best ${streak.bestCount}d.`,
    `Next milestone reward at ${Math.ceil((streak.bestCount + 1) / STREAK_MILESTONE) * STREAK_MILESTONE}d.`,
  ].join("\n");
}

function pickChallengeKind(rng: () => number): DailyChallengeKind {
  const idx = Math.min(
    DAILY_CHALLENGE_KINDS.length - 1,
    Math.floor(rng() * DAILY_CHALLENGE_KINDS.length),
  );
  return DAILY_CHALLENGE_KINDS[idx]!;
}

export function ensureDailyChallenge(
  stats: PetStats,
  now: number,
  rng: () => number = Math.random,
): { stats: PetStats; freshly: boolean } {
  const today = localDateStamp(now);
  const existing = stats.dailyChallenge;
  if (existing && existing.date === today) {
    return { stats, freshly: false };
  }
  const kind = pickChallengeKind(rng);
  const fresh: DailyChallenge = {
    date: today,
    kind,
    target: KIND_TARGETS[kind],
    progress: 0,
    rewarded: false,
  };
  return { stats: { ...stats, dailyChallenge: fresh }, freshly: true };
}

export interface ChallengeProgress {
  stats: PetStats;
  completedNow: boolean;
}

export function bumpDailyChallenge(
  stats: PetStats,
  kind: DailyChallengeKind | "pet_action",
  amount: number = 1,
  now: number = Date.now(),
): ChallengeProgress {
  const c = stats.dailyChallenge;
  if (!c || c.rewarded) return { stats, completedNow: false };
  const today = localDateStamp(now);
  if (c.date !== today) return { stats, completedNow: false };
  // pet_action is a virtual feeder for the pet_action_10 challenge.
  const matchKind: DailyChallengeKind | null =
    kind === "pet_action" ? (c.kind === "pet_action_10" ? "pet_action_10" : null) : kind;
  if (matchKind !== c.kind) return { stats, completedNow: false };
  const nextProgress = Math.min(c.target, c.progress + amount);
  if (nextProgress === c.progress) return { stats, completedNow: false };
  const reached = nextProgress >= c.target;
  const next: DailyChallenge = {
    ...c,
    progress: nextProgress,
    rewarded: reached,
  };
  return { stats: { ...stats, dailyChallenge: next }, completedNow: reached };
}

export function applyChallengeReward(stats: PetStats): PetStats {
  const c = stats.dailyChallenge;
  if (!c || !c.rewarded) return stats;
  const inv = stats.inventory ?? { coffee: 0, pastry: 0, charter: 0 };
  return {
    ...stats,
    deals: Math.min(100, stats.deals + 25),
    inventory: { ...inv, charter: inv.charter + 1 },
  };
}

export function renderChallenge(stats: PetStats): string {
  const c = stats.dailyChallenge;
  if (!c) return "No daily challenge yet. Toggle /pet on to roll one.";
  const label = KIND_LABELS[c.kind];
  const status = c.rewarded ? "rewarded" : c.progress >= c.target ? "complete" : "in progress";
  return [
    `Daily challenge (${c.date}): ${label}`,
    `  progress ${c.progress}/${c.target} · ${status}`,
    c.rewarded ? "Reward already claimed." : "Reward: +25 deals + 1 charter.",
  ].join("\n");
}
