import { localDateStamp } from "./trade.ts";
import type { PetStats, ReviewCounters } from "./petState.ts";

export interface ReviewSnapshot {
  date: string;
  dealsClosed: number;
  eventsSurvived: number;
  happinessDelta: number;
  energyDelta: number;
  mood: string;
  oneLiner: string;
}

const ONE_LINERS: ReadonlyArray<string> = [
  "Drexler files yesterday under 'acceptable.' Back to the pipeline.",
  "Drexler reviews the tape. Nods once. Resumes posture.",
  "Yesterday's deals shelved. Today's deck demanded.",
  "Drexler audits the prior day. Numbers survive review.",
  "Yesterday's chart logged. Drexler resumes hostilities.",
];

export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isNewLocalDay(lastReviewAt: number | undefined, now: number): boolean {
  if (lastReviewAt === undefined) return true;
  return lastReviewAt < startOfLocalDay(now);
}

export function ensureReviewCounters(stats: PetStats, now: number): PetStats {
  const today = localDateStamp(now);
  const existing = stats.reviewCounters;
  if (existing && existing.date === today) return stats;
  const fresh: ReviewCounters = {
    date: today,
    dealsClosed: 0,
    eventsSurvived: 0,
    startHappiness: stats.happiness,
    startEnergy: stats.energy,
  };
  return { ...stats, reviewCounters: fresh };
}

export function bumpDealsClosed(stats: PetStats, n: number = 1): PetStats {
  const counters = stats.reviewCounters;
  if (!counters) return stats;
  return {
    ...stats,
    reviewCounters: { ...counters, dealsClosed: counters.dealsClosed + n },
  };
}

export function bumpEventsSurvived(stats: PetStats, n: number = 1): PetStats {
  const counters = stats.reviewCounters;
  if (!counters) return stats;
  return {
    ...stats,
    reviewCounters: { ...counters, eventsSurvived: counters.eventsSurvived + n },
  };
}

export interface BuildReviewOptions {
  stats: PetStats;
  now: number;
  oneLinerPick?: (lines: ReadonlyArray<string>) => string;
}

export function buildReviewSnapshot(opts: BuildReviewOptions): ReviewSnapshot {
  const counters = opts.stats.reviewCounters;
  const happinessDelta = counters ? opts.stats.happiness - counters.startHappiness : 0;
  const energyDelta = counters ? opts.stats.energy - counters.startEnergy : 0;
  const pick = opts.oneLinerPick ?? ((lines) => lines[Math.floor(Math.random() * lines.length)]!);
  return {
    date: localDateStamp(opts.now),
    dealsClosed: counters?.dealsClosed ?? 0,
    eventsSurvived: counters?.eventsSurvived ?? 0,
    happinessDelta,
    energyDelta,
    mood: opts.stats.happiness > 60 ? "buoyant" : opts.stats.happiness < 30 ? "grim" : "level",
    oneLiner: pick(ONE_LINERS),
  };
}

export function formatReview(snapshot: ReviewSnapshot): string {
  const arrow = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return [
    `Daily review — ${snapshot.date}`,
    `  deals closed   : ${snapshot.dealsClosed}`,
    `  events handled : ${snapshot.eventsSurvived}`,
    `  happiness arc  : ${arrow(Math.round(snapshot.happinessDelta))}`,
    `  energy arc     : ${arrow(Math.round(snapshot.energyDelta))}`,
    `  mood verdict   : ${snapshot.mood}`,
    `  drexler note   : ${snapshot.oneLiner}`,
  ].join("\n");
}

export interface ReviewGate {
  shouldShow: boolean;
  hasPriorActivity: boolean;
  reason: "new_day_with_activity" | "already_shown" | "no_activity";
}

export function evaluateReviewGate(stats: PetStats, now: number): ReviewGate {
  const newDay = isNewLocalDay(stats.lastReviewAt, now);
  const priorCount = (stats.actionHistory ?? []).length;
  const hasPriorActivity = priorCount > 0;
  if (!newDay) {
    return { shouldShow: false, hasPriorActivity, reason: "already_shown" };
  }
  if (!hasPriorActivity) {
    return { shouldShow: false, hasPriorActivity, reason: "no_activity" };
  }
  return { shouldShow: true, hasPriorActivity, reason: "new_day_with_activity" };
}

export function markReviewShown(stats: PetStats, now: number): PetStats {
  return { ...stats, lastReviewAt: now };
}
