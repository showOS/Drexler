import type { ActiveDeal, PetActionKey, PetStats } from "./petState.ts";

export const MAX_ACTIVE_DEALS = 2;
export const DEAL_SPAWN_PROB_ON_WORK = 0.35;

export interface DealTemplate {
  readonly name: string;
  readonly requirements: ReadonlyArray<{ action: PetActionKey; count: number }>;
  readonly durationMs: number;
  readonly reward: number;
}

// Mid-tier quests. Each requires multiple actions before a deadline; the
// reward goes into `lifetimeDeals` (rank ladder), not the volatile stat.
export const DEAL_POOL: ReadonlyArray<DealTemplate> = [
  {
    name: "Acme Pipeline",
    requirements: [
      { action: "work", count: 3 },
      { action: "praise", count: 1 },
    ],
    durationMs: 2 * 60 * 60_000,
    reward: 50,
  },
  {
    name: "Quarterly Close",
    requirements: [
      { action: "work", count: 2 },
      { action: "feed", count: 1 },
    ],
    durationMs: 90 * 60_000,
    reward: 35,
  },
  {
    name: "Roadshow Tour",
    requirements: [
      { action: "play", count: 2 },
      { action: "work", count: 2 },
    ],
    durationMs: 3 * 60 * 60_000,
    reward: 60,
  },
  {
    name: "Boutique Carveout",
    requirements: [
      { action: "work", count: 1 },
      { action: "vibe", count: 1 },
    ],
    durationMs: 45 * 60_000,
    reward: 20,
  },
];

let dealCounter = 0;

export function resetDealCounter(): void {
  dealCounter = 0;
}

export interface DealScheduler {
  pickTemplate: () => DealTemplate;
  shouldSpawn: () => boolean;
  rng: () => number;
}

export function defaultDealScheduler(rng: () => number = Math.random): DealScheduler {
  return {
    pickTemplate: () =>
      DEAL_POOL[Math.min(DEAL_POOL.length - 1, Math.floor(rng() * DEAL_POOL.length))]!,
    shouldSpawn: () => rng() < DEAL_SPAWN_PROB_ON_WORK,
    rng,
  };
}

function nextDealId(now: number): string {
  dealCounter += 1;
  return `deal_${now.toString(36)}_${dealCounter}`;
}

export function spawnDeal(now: number, scheduler: DealScheduler): ActiveDeal {
  const tmpl = scheduler.pickTemplate();
  return {
    id: nextDealId(now),
    name: tmpl.name,
    requirements: tmpl.requirements,
    deadline: now + tmpl.durationMs,
    started: now,
    progress: {},
    reward: tmpl.reward,
  };
}

export function maybeOfferDeal(
  stats: PetStats,
  now: number,
  scheduler: DealScheduler,
): { stats: PetStats; offered: ActiveDeal | null } {
  const current = stats.activeDeals ?? [];
  if (current.length >= MAX_ACTIVE_DEALS) return { stats, offered: null };
  if (!scheduler.shouldSpawn()) return { stats, offered: null };
  const deal = spawnDeal(now, scheduler);
  return {
    stats: { ...stats, activeDeals: [...current, deal] },
    offered: deal,
  };
}

function requirementsMet(deal: ActiveDeal): boolean {
  for (const req of deal.requirements) {
    const have = deal.progress[req.action] ?? 0;
    if (have < req.count) return false;
  }
  return true;
}

export interface DealTickResult {
  stats: PetStats;
  completed: ActiveDeal[];
  expired: ActiveDeal[];
}

// Advance progress for the action that just committed, then settle any
// deals that finished or expired. Completion bumps `lifetimeDeals`;
// expiration drops happiness slightly (V43 — never reduces rank).
export function tickDeals(
  stats: PetStats,
  action: PetActionKey | null,
  now: number,
): DealTickResult {
  const incoming = stats.activeDeals ?? [];
  if (incoming.length === 0) {
    return { stats, completed: [], expired: [] };
  }

  let lifetime = typeof stats.lifetimeDeals === "number" ? stats.lifetimeDeals : stats.deals;
  let happiness = stats.happiness;
  const completed: ActiveDeal[] = [];
  const expired: ActiveDeal[] = [];
  const survivors: ActiveDeal[] = [];

  for (const deal of incoming) {
    let progress = deal.progress;
    if (action !== null) {
      const need = deal.requirements.find((r) => r.action === action);
      if (need) {
        const have = (progress[action] ?? 0) + 1;
        if (have <= need.count) {
          progress = { ...progress, [action]: have };
        }
      }
    }
    const updated: ActiveDeal = progress === deal.progress ? deal : { ...deal, progress };

    if (requirementsMet(updated)) {
      lifetime += updated.reward;
      completed.push(updated);
      continue;
    }
    if (now >= updated.deadline) {
      happiness = Math.max(0, happiness - 10);
      expired.push(updated);
      continue;
    }
    survivors.push(updated);
  }

  const nextStats: PetStats = {
    ...stats,
    activeDeals: survivors.length > 0 ? survivors : undefined,
    lifetimeDeals: lifetime,
    happiness,
  };

  return { stats: nextStats, completed, expired };
}

export function formatDeal(deal: ActiveDeal, now: number): string {
  const remainingMs = Math.max(0, deal.deadline - now);
  const mins = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(mins / 60);
  const minStr = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
  const reqs = deal.requirements
    .map((r) => {
      const have = deal.progress[r.action] ?? 0;
      return `${r.action} ${have}/${r.count}`;
    })
    .join(", ");
  return `${deal.name} — ${reqs} · ${minStr} left · reward ${deal.reward}`;
}

export function listDeals(stats: PetStats, now: number = Date.now()): string[] {
  const deals = stats.activeDeals ?? [];
  if (deals.length === 0) return [];
  return deals.map((d) => formatDeal(d, now));
}
