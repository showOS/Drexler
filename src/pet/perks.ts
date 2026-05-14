import type { PetStats } from "./petState.ts";

export type PerkId =
  | "slow_decay"
  | "quick_recovery"
  | "big_meals"
  | "trade_eye"
  | "pipeline"
  | "chartered"
  | "iron_liver"
  | "rainmaker";

export interface PerkDef {
  readonly id: PerkId;
  readonly title: string;
  readonly description: string;
}

export const PERKS: ReadonlyArray<PerkDef> = [
  { id: "slow_decay", title: "Slow Decay", description: "Stat decay ×0.8." },
  { id: "quick_recovery", title: "Quick Recovery", description: "Action cooldown −30s." },
  { id: "big_meals", title: "Big Meals", description: "Feed + pastry effect ×1.5." },
  { id: "trade_eye", title: "Trade Eye", description: "Trade win bias bumped." },
  { id: "pipeline", title: "Pipeline", description: "Concurrent deals cap 2→3." },
  { id: "chartered", title: "Chartered", description: "Bonus /trade each RTH session." },
  { id: "iron_liver", title: "Iron Liver", description: "Coffee energy +50%." },
  { id: "rainmaker", title: "Rainmaker", description: "Synergy bonuses ×1.5." },
];

export const PERK_IDS: ReadonlySet<PerkId> = new Set(PERKS.map((p) => p.id));

export function isPerkId(value: unknown): value is PerkId {
  return typeof value === "string" && PERK_IDS.has(value as PerkId);
}

export function parsePerkId(value: string): PerkId | null {
  const lo = value.toLowerCase();
  return isPerkId(lo) ? lo : null;
}

function ownedPerks(stats: PetStats): ReadonlyArray<PerkId> {
  const perks = stats.perks;
  if (!Array.isArray(perks)) return [];
  return perks.filter(isPerkId);
}

export function hasPerk(stats: PetStats, id: PerkId): boolean {
  return ownedPerks(stats).includes(id);
}

export interface PerkPointGrant {
  stats: PetStats;
  granted: boolean;
}

// Grants 1 point when rank moved forward. Caller passes prev → next rank
// after a commit. Decay-induced drops never refund (V52).
export function grantPerkPointOnPromotion(
  stats: PetStats,
  prevRankIndex: number,
  nextRankIndex: number,
): PerkPointGrant {
  if (nextRankIndex <= prevRankIndex) return { stats, granted: false };
  const current = typeof stats.perkPoints === "number" ? Math.max(0, stats.perkPoints) : 0;
  return {
    stats: { ...stats, perkPoints: current + (nextRankIndex - prevRankIndex) },
    granted: true,
  };
}

export type SpendOutcome =
  | { ok: true; stats: PetStats; def: PerkDef }
  | { ok: false; reason: "no_points" | "already_owned" | "unknown"; message: string };

export function spendPerkPoint(stats: PetStats, id: PerkId): SpendOutcome {
  if (!isPerkId(id)) {
    return { ok: false, reason: "unknown", message: `Unknown perk: ${id}.` };
  }
  if (hasPerk(stats, id)) {
    return { ok: false, reason: "already_owned", message: `Already own ${id}.` };
  }
  const points = typeof stats.perkPoints === "number" ? Math.max(0, stats.perkPoints) : 0;
  if (points <= 0) {
    return { ok: false, reason: "no_points", message: "No promotion points available." };
  }
  const def = PERKS.find((p) => p.id === id)!;
  const ownedList = ownedPerks(stats);
  const next: PetStats = {
    ...stats,
    perks: [...ownedList, id],
    perkPoints: points - 1,
  };
  return { ok: true, stats: next, def };
}

// Multipliers consumed by reducers + decay + trade + cooldown. Returns a
// number that callers fold into `applyDecay(stats, now, mult)` or apply
// after their base math.
export function perkDecayMultiplier(stats: PetStats): number {
  return hasPerk(stats, "slow_decay") ? 0.8 : 1;
}

export function perkCooldownReductionMs(stats: PetStats): number {
  return hasPerk(stats, "quick_recovery") ? 30_000 : 0;
}

export function perkFeedMultiplier(stats: PetStats): number {
  return hasPerk(stats, "big_meals") ? 1.5 : 1;
}

export function perkPipelineCap(stats: PetStats, base: number): number {
  return hasPerk(stats, "pipeline") ? base + 1 : base;
}

export function perkChartered(stats: PetStats): boolean {
  return hasPerk(stats, "chartered");
}

export function perkCoffeeBonus(stats: PetStats): number {
  return hasPerk(stats, "iron_liver") ? 1.5 : 1;
}

export function perkSynergyMultiplier(stats: PetStats): number {
  return hasPerk(stats, "rainmaker") ? 1.5 : 1;
}

export function perkTradeEye(stats: PetStats): boolean {
  return hasPerk(stats, "trade_eye");
}

export function renderPerks(stats: PetStats): string {
  const owned = new Set(ownedPerks(stats));
  const points = typeof stats.perkPoints === "number" ? Math.max(0, stats.perkPoints) : 0;
  const lines = [
    `Perks (${owned.size}/${PERKS.length} owned, ${points} unspent point${points === 1 ? "" : "s"}):`,
  ];
  for (const def of PERKS) {
    const mark = owned.has(def.id) ? "★" : "·";
    lines.push(`  ${mark} ${def.id} — ${def.title}: ${def.description}`);
  }
  lines.push("Spend a point with /perk <id>.");
  return lines.join("\n");
}
