import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PetActivity =
  | "idle"
  | "eating"
  | "playing"
  | "working"
  | "sleeping"
  | "praised"
  | "vibing";

export interface PetStats {
  hunger: number;
  happiness: number;
  energy: number;
  deals: number;
  lastSaved: number;
  dead?: boolean;
  name?: string;
  createdAt?: number;
  lastActionAt?: Partial<Record<PetActionKey, number>>;
  lifetimeDeals?: number;
}

const MAX_NAME_LEN = 16;
const NAME_SANITIZE_RE = /[^\p{L}\p{N} ._'-]/gu;

export function sanitizePetName(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(NAME_SANITIZE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_NAME_LEN);
}

// Per-hour decay rates
const DECAY_PER_HOUR = {
  hunger: 15,
  happiness: 8,
  energy: 10,
  deals: 5,
};

export type PetActionKey =
  | "feed"
  | "play"
  | "work"
  | "praise"
  | "rest"
  | "vibe";

export const PET_COOLDOWN_MS = 90_000;

interface CooldownCheck {
  ok: boolean;
  remainingMs: number;
}

export function actionCooldown(
  stats: PetStats,
  action: PetActionKey,
  now: number = Date.now(),
): CooldownCheck {
  const last = stats.lastActionAt?.[action];
  if (typeof last !== "number" || !Number.isFinite(last)) {
    return { ok: true, remainingMs: 0 };
  }
  const elapsed = now - last;
  if (elapsed >= PET_COOLDOWN_MS) return { ok: true, remainingMs: 0 };
  return { ok: false, remainingMs: PET_COOLDOWN_MS - elapsed };
}

export function stampAction(
  stats: PetStats,
  action: PetActionKey,
  now: number = Date.now(),
): PetStats {
  return {
    ...stats,
    lastActionAt: { ...(stats.lastActionAt ?? {}), [action]: now },
  };
}

export function formatCooldownRemaining(remainingMs: number): string {
  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const DEFAULT_STATS: PetStats = {
  hunger: 80,
  happiness: 75,
  energy: 85,
  deals: 30,
  lastSaved: Date.now(),
  createdAt: Date.now(),
};

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function petDir(): string {
  return join(getHome(), ".drexler");
}

function petFile(): string {
  return join(petDir(), "pet.json");
}

function defaultStats(): PetStats {
  const now = Date.now();
  return { ...DEFAULT_STATS, lastSaved: now, createdAt: now };
}

function clamp(v: unknown, fallback = 0): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(0, Math.min(100, n));
}

function safeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Date.now();
}

function applyDecay(stats: PetStats): PetStats {
  const elapsed = Math.max(0, (Date.now() - stats.lastSaved) / 3_600_000);
  return {
    ...stats,
    hunger: clamp(stats.hunger - DECAY_PER_HOUR.hunger * elapsed),
    happiness: clamp(stats.happiness - DECAY_PER_HOUR.happiness * elapsed),
    energy: clamp(stats.energy - DECAY_PER_HOUR.energy * elapsed),
    deals: clamp(stats.deals - DECAY_PER_HOUR.deals * elapsed),
    lastSaved: Date.now(),
  };
}

export function loadPetState(): PetStats {
  try {
    const target = petFile();
    if (existsSync(target)) {
      const raw = readFileSync(target, "utf8");
      const parsed = JSON.parse(raw) as Partial<PetStats>;
      if (parsed.dead === true) {
        // Drexler died — reset to halfway on next startup
        const revived = {
          ...defaultStats(),
          hunger: 50,
          happiness: 50,
          energy: 50,
          deals: 25,
        };
        writeFileSync(target, JSON.stringify(revived, null, 2));
        return revived;
      }
      const lastActionAt: Partial<Record<PetActionKey, number>> = {};
      const rawActions = parsed.lastActionAt;
      if (rawActions && typeof rawActions === "object") {
        for (const key of ["feed", "play", "work", "praise", "rest", "vibe"] as const) {
          const v = (rawActions as Record<string, unknown>)[key];
          if (typeof v === "number" && Number.isFinite(v)) {
            lastActionAt[key] = v;
          }
        }
      }
      const stats: PetStats = {
        hunger: clamp(parsed.hunger, DEFAULT_STATS.hunger),
        happiness: clamp(parsed.happiness, DEFAULT_STATS.happiness),
        energy: clamp(parsed.energy, DEFAULT_STATS.energy),
        deals: clamp(parsed.deals, DEFAULT_STATS.deals),
        lastSaved: safeTimestamp(parsed.lastSaved),
        createdAt:
          typeof parsed.createdAt === "number" &&
          Number.isFinite(parsed.createdAt)
            ? parsed.createdAt
            : Date.now(),
        name:
          typeof parsed.name === "string" && parsed.name.length > 0
            ? sanitizePetName(parsed.name)
            : undefined,
        lastActionAt: Object.keys(lastActionAt).length > 0 ? lastActionAt : undefined,
        lifetimeDeals:
          typeof parsed.lifetimeDeals === "number" &&
          Number.isFinite(parsed.lifetimeDeals) &&
          parsed.lifetimeDeals >= 0
            ? parsed.lifetimeDeals
            : undefined,
      };
      return applyDecay(stats);
    }
  } catch {
    // fall through to defaults
  }
  return defaultStats();
}

export function savePetState(stats: PetStats): void {
  try {
    const dir = petDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = petFile();
    // Atomic write: temp + rename so a crash mid-write leaves the prior
    // pet.json intact rather than a truncated zero-byte file.
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    try {
      writeFileSync(
        tmp,
        JSON.stringify({ ...stats, lastSaved: Date.now() }, null, 2),
      );
      renameSync(tmp, target);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {}
      throw err;
    }
  } catch {
    // best-effort
  }
}

export function applyFeed(stats: PetStats): PetStats {
  return {
    ...stats,
    hunger: clamp(stats.hunger + 25),
    happiness: clamp(stats.happiness + 5),
    deals: clamp(stats.deals + 10),
  };
}

export function applyPlay(stats: PetStats): PetStats {
  return {
    ...stats,
    happiness: clamp(stats.happiness + 20),
    energy: clamp(stats.energy - 10),
    deals: clamp(stats.deals + 5),
  };
}

export function applyWork(stats: PetStats): PetStats {
  return {
    ...stats,
    deals: clamp(stats.deals + 20),
    energy: clamp(stats.energy - 15),
    hunger: clamp(stats.hunger - 5),
  };
}

export function applyPraise(stats: PetStats): PetStats {
  return { ...stats, happiness: clamp(stats.happiness + 15) };
}

export function applyVibe(stats: PetStats): { stats: PetStats; message: string } {
  if (stats.energy < 30) {
    return {
      stats: { ...stats, energy: clamp(stats.energy + 20) },
      message: "Drexler naps briefly under desk. Power restored.",
    };
  }
  if (stats.hunger < 30) {
    return {
      stats: applyFeed(stats),
      message: "Drexler finds a forgotten deal memo and eats it.",
    };
  }
  const roll = Math.random();
  if (roll < 0.25) {
    return {
      stats: { ...stats, happiness: clamp(stats.happiness + 10), deals: clamp(stats.deals + 15) },
      message: "Drexler does spontaneous deal origination. Numbers climbing.",
    };
  }
  if (roll < 0.5) {
    return {
      stats: { ...stats, happiness: clamp(stats.happiness + 8) },
      message: "Drexler stares out window. Market conditions assessed.",
    };
  }
  if (roll < 0.75) {
    return {
      stats: { ...stats, energy: clamp(stats.energy + 10) },
      message: "Drexler conducts standing meeting with himself. Productive.",
    };
  }
  return {
    stats: { ...stats, happiness: clamp(stats.happiness + 12), energy: clamp(stats.energy - 5) },
    message: "Drexler practices pitch deck delivery to the plant.",
  };
}

export function applyRest(stats: PetStats): PetStats {
  return {
    ...stats,
    energy: clamp(stats.energy + 30),
    happiness: clamp(stats.happiness + 5),
  };
}

export function applyMinuteDecay(stats: PetStats): PetStats {
  const rate = 1 / 60;
  return {
    ...stats,
    hunger: clamp(stats.hunger - DECAY_PER_HOUR.hunger * rate),
    happiness: clamp(stats.happiness - DECAY_PER_HOUR.happiness * rate),
    energy: clamp(stats.energy - DECAY_PER_HOUR.energy * rate),
    deals: clamp(stats.deals - DECAY_PER_HOUR.deals * rate),
  };
}

export function isPetDead(stats: PetStats): boolean {
  return stats.hunger <= 0 || stats.happiness <= 0 || stats.energy <= 0;
}

export type PetRank = "intern" | "analyst" | "associate" | "vp" | "md";

const RANK_THRESHOLDS: ReadonlyArray<{ threshold: number; rank: PetRank }> = [
  { threshold: 0, rank: "intern" },
  { threshold: 200, rank: "analyst" },
  { threshold: 400, rank: "associate" },
  { threshold: 600, rank: "vp" },
  { threshold: 800, rank: "md" },
];

// Lifetime deal count drives rank progression. We track it separately from
// the volatile `deals` stat so decay/spam don't roll a pet back to intern.
export function lifetimeDeals(stats: PetStats): number {
  if (typeof stats.lifetimeDeals === "number" && Number.isFinite(stats.lifetimeDeals)) {
    return Math.max(0, stats.lifetimeDeals);
  }
  return stats.deals;
}

export function getPetRank(stats: PetStats): PetRank {
  const total = lifetimeDeals(stats);
  let current: PetRank = "intern";
  for (const tier of RANK_THRESHOLDS) {
    if (total >= tier.threshold) current = tier.rank;
  }
  return current;
}

export function rankLabel(rank: PetRank): string {
  switch (rank) {
    case "intern":    return "Intern";
    case "analyst":   return "Analyst";
    case "associate": return "Associate";
    case "vp":        return "Vice President";
    case "md":        return "Managing Director";
  }
}

const RANK_INCREMENTS: Record<Exclude<PetActionKey, "rest" | "praise">, number> = {
  feed: 2,
  play: 1,
  work: 8,
  vibe: 3,
};

export function accrueLifetimeDeals(stats: PetStats, action: PetActionKey): PetStats {
  if (action === "rest" || action === "praise") return stats;
  const inc = RANK_INCREMENTS[action];
  const next = lifetimeDeals(stats) + inc;
  return { ...stats, lifetimeDeals: next };
}

export function applyName(stats: PetStats, name: string): PetStats {
  const cleaned = sanitizePetName(name);
  return { ...stats, name: cleaned.length > 0 ? cleaned : undefined };
}

export function petTenureMs(stats: PetStats, now: number = Date.now()): number {
  if (typeof stats.createdAt !== "number" || !Number.isFinite(stats.createdAt)) {
    return 0;
  }
  return Math.max(0, now - stats.createdAt);
}

export function formatTenure(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function getPetMood(stats: PetStats): string {
  if (stats.energy < 25) return "exhausted";
  if (stats.hunger < 25) return "hungry";
  if (stats.happiness > 80) return "manic";
  if (stats.happiness < 30) return "distressed";
  if (stats.deals > 80) return "victorious";
  return "operational";
}
