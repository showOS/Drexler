import type { PetStats } from "./petState.ts";

export type WorldEventKind = "market_crash" | "ipo_mania" | "audit_week" | "holiday";

export interface WorldEventRecord {
  kind: WorldEventKind;
  startedAt: number;
  expiresAt: number;
}

export interface WorldEventDef {
  readonly kind: WorldEventKind;
  readonly title: string;
  readonly description: string;
  readonly durationMs: number;
}

export const WORLD_EVENTS: ReadonlyArray<WorldEventDef> = [
  {
    kind: "market_crash",
    title: "MARKET CRASH",
    description: "Trade losses ×2; win deltas unchanged. Survival mode.",
    durationMs: 2 * 60 * 60_000,
  },
  {
    kind: "ipo_mania",
    title: "IPO MANIA",
    description: "/work deal gain ×1.5. Bull run on the floor.",
    durationMs: 3 * 60 * 60_000,
  },
  {
    kind: "audit_week",
    title: "AUDIT WEEK",
    description: "Event spawn gap halved. More encounters incoming.",
    durationMs: 4 * 60 * 60_000,
  },
  {
    kind: "holiday",
    title: "HOLIDAY",
    description: "Stat decay ×0.5. Drexler unwinds.",
    durationMs: 6 * 60 * 60_000,
  },
];

const KIND_INDEX: ReadonlyMap<WorldEventKind, WorldEventDef> = new Map(
  WORLD_EVENTS.map((d) => [d.kind, d]),
);

export const WORLD_SPAWN_PROB = 0.05;

export interface WorldScheduler {
  shouldSpawn: () => boolean;
  pickEvent: () => WorldEventDef;
}

export function defaultWorldScheduler(rng: () => number = Math.random): WorldScheduler {
  return {
    shouldSpawn: () => rng() < WORLD_SPAWN_PROB,
    pickEvent: () => {
      const idx = Math.min(WORLD_EVENTS.length - 1, Math.floor(rng() * WORLD_EVENTS.length));
      return WORLD_EVENTS[idx]!;
    },
  };
}

export function activeWorldEvent(stats: PetStats, now: number = Date.now()): WorldEventDef | null {
  const w = stats.worldEvent;
  if (!w) return null;
  if (now >= w.expiresAt) return null;
  return KIND_INDEX.get(w.kind) ?? null;
}

export interface WorldSpawnResult {
  stats: PetStats;
  spawned: WorldEventDef | null;
}

export function maybeSpawnWorldEvent(
  stats: PetStats,
  now: number,
  scheduler: WorldScheduler,
): WorldSpawnResult {
  if (activeWorldEvent(stats, now)) return { stats, spawned: null };
  if (!scheduler.shouldSpawn()) return { stats, spawned: null };
  const def = scheduler.pickEvent();
  const record: WorldEventRecord = {
    kind: def.kind,
    startedAt: now,
    expiresAt: now + def.durationMs,
  };
  return { stats: { ...stats, worldEvent: record }, spawned: def };
}

export interface WorldExpireResult {
  stats: PetStats;
  expired: WorldEventDef | null;
}

export function expireWorldEvent(stats: PetStats, now: number = Date.now()): WorldExpireResult {
  const w = stats.worldEvent;
  if (!w) return { stats, expired: null };
  if (now < w.expiresAt) return { stats, expired: null };
  const def = KIND_INDEX.get(w.kind) ?? null;
  const { worldEvent: _drop, ...rest } = stats;
  void _drop;
  return { stats: rest as PetStats, expired: def };
}

// Modifier helpers consumed by reducers + decay + spawn cadence + trade.
// Defaults to neutral when no world event is active. (V58)
export function worldDecayMultiplier(stats: PetStats, now: number = Date.now()): number {
  const def = activeWorldEvent(stats, now);
  return def?.kind === "holiday" ? 0.5 : 1;
}

export function worldWorkDealMultiplier(stats: PetStats, now: number = Date.now()): number {
  const def = activeWorldEvent(stats, now);
  return def?.kind === "ipo_mania" ? 1.5 : 1;
}

export function worldTradeLossMultiplier(stats: PetStats, now: number = Date.now()): number {
  const def = activeWorldEvent(stats, now);
  return def?.kind === "market_crash" ? 2 : 1;
}

export function worldEventGapMultiplier(stats: PetStats, now: number = Date.now()): number {
  const def = activeWorldEvent(stats, now);
  return def?.kind === "audit_week" ? 0.5 : 1;
}

export function renderWorldEvent(stats: PetStats, now: number = Date.now()): string {
  const def = activeWorldEvent(stats, now);
  if (!def) return "No active world event.";
  const remainingMs = Math.max(0, (stats.worldEvent?.expiresAt ?? 0) - now);
  const mins = Math.ceil(remainingMs / 60_000);
  return `${def.title} — ${def.description} (~${mins}m remaining)`;
}
