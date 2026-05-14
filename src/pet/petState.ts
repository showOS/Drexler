import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

// pet.json persistence intentionally diverges from `withJsonFileLock`
// (src/pet/fileLock.ts) — V64 documents why both pipelines coexist.
//
//   - Achievements + graveyard use `withJsonFileLock`: append-only,
//     read-modify-write at human cadence, tolerant of a one-shot fail.
//   - pet.json writes here are HIGH-FREQUENCY (every decay tick, every
//     action commit) and MUST settle in FIFO order across React's
//     concurrent rendering. The queue below guarantees the *latest*
//     scheduled call lands last on disk; `flushPetSaves()` (V35) drains
//     it on SIGINT / unmount with a hard 2s cap; the owned lockfile
//     token enables cross-instance contention handling (V33).
//
// Both surfaces are atomic temp+rename. New persistent files must pick
// one of the two paths and not re-implement a third.
let saveQueue: Promise<PetSaveResult> = Promise.resolve({ ok: true });
let queueGeneration = 0;
let heldLockToken: string | null = null;

export type PetActivity =
  | "idle"
  | "eating"
  | "playing"
  | "working"
  | "sleeping"
  | "praised"
  | "vibing";

export interface ActionHistoryEntry {
  action: PetActionKey;
  at: number;
}

export interface ActiveDeal {
  id: string;
  name: string;
  requirements: ReadonlyArray<{ action: PetActionKey; count: number }>;
  deadline: number;
  started: number;
  progress: Partial<Record<PetActionKey, number>>;
  reward: number;
}

export interface PetInventory {
  coffee: number;
  pastry: number;
  charter: number;
}

export interface TradeSessionRecord {
  date: string;
  seed: number;
  used: boolean;
  bonusAvailable?: boolean;
}

export interface PetStreakRecord {
  lastActiveDate: string;
  count: number;
  bestCount: number;
  milestoneClaimedAt: number;
}

export type PetDailyChallengeKind =
  | "close_deals_2"
  | "win_trade"
  | "survive_2_events"
  | "synergy_1"
  | "pet_action_10";

export interface PetDailyChallenge {
  date: string;
  kind: PetDailyChallengeKind;
  target: number;
  progress: number;
  rewarded: boolean;
}

export type PetWorldEventKind = "market_crash" | "ipo_mania" | "audit_week" | "holiday";

export interface PetWorldEventRecord {
  kind: PetWorldEventKind;
  startedAt: number;
  expiresAt: number;
}

export type PetArchetype = "closer" | "networker" | "operator";

export interface PetBossRecord {
  id: string;
  step: number;
  startedAt: number;
  deadline: number;
}

export interface PetMinigameRecord {
  lastPitchAt?: number;
  lastNegotiateAt?: number;
}

export interface AchievementProgress {
  tradeWins: number;
  auditEventsSurvived: number;
  synergyIds: string[];
  pipelineCompletions: number;
  chartersUsed: number;
  pitchHits: number;
  negotiateWins: number;
  healthySince?: number;
  respawned?: boolean;
  seenWorldEvents: string[];
  survivedWorldEvents: string[];
}

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
  activeDeals?: ActiveDeal[];
  actionHistory?: ActionHistoryEntry[];
  inventory?: PetInventory;
  tradeSession?: TradeSessionRecord;
  lastReviewAt?: number;
  reviewCounters?: ReviewCounters;
  perks?: string[];
  perkPoints?: number;
  streak?: PetStreakRecord;
  dailyChallenge?: PetDailyChallenge;
  worldEvent?: PetWorldEventRecord;
  archetype?: PetArchetype;
  boss?: PetBossRecord;
  minigame?: PetMinigameRecord;
  achievementProgress?: AchievementProgress;
}

export interface ReviewCounters {
  date: string;
  dealsClosed: number;
  eventsSurvived: number;
  startHappiness: number;
  startEnergy: number;
}

export const ACTION_HISTORY_LIMIT = 4;
export const INVENTORY_KEYS = ["coffee", "pastry", "charter"] as const;
export type InventoryKey = (typeof INVENTORY_KEYS)[number];
export const INVENTORY_COSTS: Readonly<Record<InventoryKey, number>> = {
  coffee: 20,
  pastry: 15,
  charter: 30,
};

export function emptyInventory(): PetInventory {
  return { coffee: 0, pastry: 0, charter: 0 };
}

export function normalizeInventory(input: unknown): PetInventory {
  const base = emptyInventory();
  if (!input || typeof input !== "object") return base;
  for (const key of INVENTORY_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      base[key] = Math.floor(v);
    }
  }
  return base;
}

export function appendActionHistory(
  stats: PetStats,
  action: PetActionKey,
  now: number = Date.now(),
): PetStats {
  const prior = stats.actionHistory ?? [];
  const next = [...prior, { action, at: now }];
  while (next.length > ACTION_HISTORY_LIMIT) next.shift();
  return { ...stats, actionHistory: next };
}

export type PetSaveResult =
  | { ok: true }
  | { ok: false; reason: "locked" | "write_failed" | "timeout"; message?: string };

interface PetLockRecord {
  pid: number;
  token: string;
  createdAt: number;
  hostname: string;
}

export const PET_LOCK_TTL_MS = 15_000;

const MAX_NAME_LEN = 16;
const NAME_SANITIZE_RE = /[^\p{L}\p{N} ._'-]/gu;
// Strip ALL Unicode format/control marks (bidi overrides, ZWJ/ZWNJ,
// BOM, word joiner, mathematical invisibles) before character-class
// filtering — otherwise a name like "Max" can render as "xaM" via an
// embedded U+202E RIGHT-TO-LEFT OVERRIDE that survives NFKC.
const NAME_BIDI_STRIP_RE = /\p{Cf}/gu;

export function sanitizePetName(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(NAME_BIDI_STRIP_RE, "")
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

export type PetActionKey = "feed" | "play" | "work" | "praise" | "rest" | "vibe";

// V60 — base cooldown 60s. Perks (`quick_recovery`) and inventory
// effects reduce or bypass per-action. Composers in App layer apply the
// reductions before invoking actionCooldown().
export const PET_COOLDOWN_MS = 60_000;

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
  // Clock skew backwards (timestamp set in the future) shouldn't lock
  // the user out for the cooldown window — treat as no cooldown and
  // let the next stampAction overwrite the stale future value.
  if (elapsed < 0) return { ok: true, remainingMs: 0 };
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

const DAILY_CHALLENGE_KIND_SET: ReadonlySet<PetDailyChallengeKind> = new Set([
  "close_deals_2",
  "win_trade",
  "survive_2_events",
  "synergy_1",
  "pet_action_10",
]);
const WORLD_KIND_SET: ReadonlySet<PetWorldEventKind> = new Set([
  "market_crash",
  "ipo_mania",
  "audit_week",
  "holiday",
]);
const BOSS_STEPS: Readonly<Record<string, number>> = { quarterly_earnings: 4 };
const KNOWN_PERKS = new Set([
  "slow_decay",
  "quick_recovery",
  "big_meals",
  "trade_eye",
  "pipeline",
  "chartered",
  "iron_liver",
  "rainmaker",
]);

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

function safeTimestamp(value: unknown, fallback: number = Date.now()): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const ACTION_KEY_SET: ReadonlySet<PetActionKey> = new Set<PetActionKey>([
  "feed",
  "play",
  "work",
  "praise",
  "rest",
  "vibe",
]);

function isPetActionKey(value: unknown): value is PetActionKey {
  return typeof value === "string" && ACTION_KEY_SET.has(value as PetActionKey);
}

function parseActionHistory(input: unknown): ActionHistoryEntry[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: ActionHistoryEntry[] = [];
  for (const item of input) {
    if (item && typeof item === "object") {
      const action = (item as Record<string, unknown>).action;
      const at = (item as Record<string, unknown>).at;
      if (isPetActionKey(action) && typeof at === "number" && Number.isFinite(at)) {
        out.push({ action, at });
      }
    }
  }
  while (out.length > ACTION_HISTORY_LIMIT) out.shift();
  return out.length > 0 ? out : undefined;
}

function parseActiveDeals(input: unknown, cap = 2): ActiveDeal[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: ActiveDeal[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    if (typeof o.deadline !== "number" || !Number.isFinite(o.deadline)) continue;
    if (typeof o.started !== "number" || !Number.isFinite(o.started)) continue;
    if (typeof o.reward !== "number" || !Number.isFinite(o.reward)) continue;
    if (!Array.isArray(o.requirements)) continue;
    const reqs: { action: PetActionKey; count: number }[] = [];
    for (const r of o.requirements) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      if (isPetActionKey(rr.action) && typeof rr.count === "number" && rr.count > 0) {
        reqs.push({ action: rr.action, count: Math.floor(rr.count) });
      }
    }
    if (reqs.length === 0) continue;
    const progress: ActiveDeal["progress"] = {};
    if (o.progress && typeof o.progress === "object") {
      for (const key of ACTION_KEY_SET) {
        const v = (o.progress as Record<string, unknown>)[key];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          progress[key] = Math.floor(v);
        }
      }
    }
    out.push({
      id: o.id,
      name: o.name,
      requirements: reqs,
      deadline: o.deadline,
      started: o.started,
      progress,
      reward: Math.max(0, Math.floor(o.reward)),
    });
  }
  return out.length > 0 ? out.slice(0, Math.max(0, Math.floor(cap))) : undefined;
}

function parseTradeSession(input: unknown): TradeSessionRecord | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.date !== "string") return undefined;
  if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) return undefined;
  if (typeof o.used !== "boolean") return undefined;
  const record: TradeSessionRecord = {
    date: o.date,
    seed: o.seed >>> 0,
    used: o.used,
  };
  if (typeof o.bonusAvailable === "boolean") record.bonusAvailable = o.bonusAvailable;
  return record;
}

function parsePerks(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !KNOWN_PERKS.has(item) || out.includes(item)) continue;
    out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function parseStreak(input: unknown): PetStats["streak"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.lastActiveDate !== "string") return undefined;
  return {
    lastActiveDate: o.lastActiveDate,
    count:
      typeof o.count === "number" && Number.isFinite(o.count)
        ? Math.max(0, Math.floor(o.count))
        : 0,
    bestCount:
      typeof o.bestCount === "number" && Number.isFinite(o.bestCount)
        ? Math.max(0, Math.floor(o.bestCount))
        : 0,
    milestoneClaimedAt:
      typeof o.milestoneClaimedAt === "number" && Number.isFinite(o.milestoneClaimedAt)
        ? Math.max(0, Math.floor(o.milestoneClaimedAt))
        : 0,
  };
}

function parseDailyChallenge(input: unknown): PetStats["dailyChallenge"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (
    typeof o.date !== "string" ||
    typeof o.kind !== "string" ||
    !DAILY_CHALLENGE_KIND_SET.has(o.kind as PetDailyChallengeKind) ||
    typeof o.target !== "number" ||
    !Number.isFinite(o.target) ||
    typeof o.progress !== "number" ||
    !Number.isFinite(o.progress) ||
    typeof o.rewarded !== "boolean"
  ) {
    return undefined;
  }
  return {
    date: o.date,
    kind: o.kind as PetDailyChallengeKind,
    target: Math.max(0, Math.floor(o.target)),
    progress: Math.max(0, Math.floor(o.progress)),
    rewarded: o.rewarded,
  };
}

function parseWorldEvent(input: unknown): PetStats["worldEvent"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.kind !== "string") return undefined;
  if (!WORLD_KIND_SET.has(o.kind as PetWorldEventKind)) return undefined;
  if (typeof o.startedAt !== "number" || !Number.isFinite(o.startedAt)) return undefined;
  if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) return undefined;
  return {
    kind: o.kind as PetWorldEventKind,
    startedAt: o.startedAt,
    expiresAt: o.expiresAt,
  };
}

const ARCHETYPE_SET = new Set(["closer", "networker", "operator"]);
function parseArchetypeField(input: unknown): PetStats["archetype"] | undefined {
  return typeof input === "string" && ARCHETYPE_SET.has(input)
    ? (input as PetStats["archetype"])
    : undefined;
}

function parseBoss(input: unknown): PetStats["boss"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.id !== "string") return undefined;
  if (typeof o.step !== "number" || !Number.isFinite(o.step)) return undefined;
  if (typeof o.startedAt !== "number" || !Number.isFinite(o.startedAt)) return undefined;
  if (typeof o.deadline !== "number" || !Number.isFinite(o.deadline)) return undefined;
  const maxStep = BOSS_STEPS[o.id];
  if (typeof maxStep !== "number") return undefined;
  const step = Math.floor(o.step);
  if (step < 0 || step >= maxStep) return undefined;
  return {
    id: o.id,
    step,
    startedAt: o.startedAt,
    deadline: o.deadline,
  };
}

function parseStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === "string" && item.length > 0 && !out.includes(item)) out.push(item);
  }
  return out;
}

export function emptyAchievementProgress(now: number = Date.now()): AchievementProgress {
  return {
    tradeWins: 0,
    auditEventsSurvived: 0,
    synergyIds: [],
    pipelineCompletions: 0,
    chartersUsed: 0,
    pitchHits: 0,
    negotiateWins: 0,
    healthySince: now,
    respawned: false,
    seenWorldEvents: [],
    survivedWorldEvents: [],
  };
}

function parseAchievementProgress(input: unknown, now: number): AchievementProgress | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const n = (key: string) =>
    typeof o[key] === "number" && Number.isFinite(o[key])
      ? Math.max(0, Math.floor(o[key] as number))
      : 0;
  const progress: AchievementProgress = {
    tradeWins: n("tradeWins"),
    auditEventsSurvived: n("auditEventsSurvived"),
    synergyIds: parseStringList(o.synergyIds),
    pipelineCompletions: n("pipelineCompletions"),
    chartersUsed: n("chartersUsed"),
    pitchHits: n("pitchHits"),
    negotiateWins: n("negotiateWins"),
    healthySince:
      typeof o.healthySince === "number" && Number.isFinite(o.healthySince) ? o.healthySince : now,
    respawned: o.respawned === true,
    seenWorldEvents: parseStringList(o.seenWorldEvents),
    survivedWorldEvents: parseStringList(o.survivedWorldEvents),
  };
  return progress;
}

function effectiveDealCap(stats: Pick<PetStats, "perks">): number {
  return stats.perks?.includes("pipeline") ? 3 : 2;
}

function parseMinigame(input: unknown): PetStats["minigame"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const out: { lastPitchAt?: number; lastNegotiateAt?: number } = {};
  if (typeof o.lastPitchAt === "number" && Number.isFinite(o.lastPitchAt)) {
    out.lastPitchAt = o.lastPitchAt;
  }
  if (typeof o.lastNegotiateAt === "number" && Number.isFinite(o.lastNegotiateAt)) {
    out.lastNegotiateAt = o.lastNegotiateAt;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseReviewCounters(input: unknown): ReviewCounters | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.date !== "string") return undefined;
  const dealsClosed =
    typeof o.dealsClosed === "number" ? Math.max(0, Math.floor(o.dealsClosed)) : 0;
  const eventsSurvived =
    typeof o.eventsSurvived === "number" ? Math.max(0, Math.floor(o.eventsSurvived)) : 0;
  const startHappiness =
    typeof o.startHappiness === "number" && Number.isFinite(o.startHappiness)
      ? o.startHappiness
      : 0;
  const startEnergy =
    typeof o.startEnergy === "number" && Number.isFinite(o.startEnergy) ? o.startEnergy : 0;
  return {
    date: o.date,
    dealsClosed,
    eventsSurvived,
    startHappiness,
    startEnergy,
  };
}

export const SESSION_ACTIVE_WINDOW_MS = 5 * 60_000;
export const SESSION_ACTIVE_DECAY_MULTIPLIER = 0.5;

export function sessionDecayMultiplier(stats: PetStats, now: number = Date.now()): number {
  const history = stats.actionHistory ?? [];
  if (history.length === 0) return 1;
  const lastAt = history[history.length - 1]!.at;
  const elapsed = now - lastAt;
  if (elapsed < 0) return SESSION_ACTIVE_DECAY_MULTIPLIER;
  return elapsed <= SESSION_ACTIVE_WINDOW_MS ? SESSION_ACTIVE_DECAY_MULTIPLIER : 1;
}

export function achievementProgressOf(
  stats: PetStats,
  now: number = Date.now(),
): AchievementProgress {
  return stats.achievementProgress ?? emptyAchievementProgress(now);
}

export function withAchievementProgress(
  stats: PetStats,
  update: (progress: AchievementProgress) => AchievementProgress,
  now: number = Date.now(),
): PetStats {
  return { ...stats, achievementProgress: update(achievementProgressOf(stats, now)) };
}

export function recordHealthyProgress(stats: PetStats, now: number = Date.now()): PetStats {
  const healthy = stats.hunger >= 30 && stats.happiness >= 30 && stats.energy >= 30;
  const progress = achievementProgressOf(stats, now);
  const healthySince = healthy ? (progress.healthySince ?? now) : undefined;
  if (stats.achievementProgress && progress.healthySince === healthySince) return stats;
  return { ...stats, achievementProgress: { ...progress, healthySince } };
}

export function recordWorldSeen(
  stats: PetStats,
  kind: PetWorldEventKind,
  now: number = Date.now(),
): PetStats {
  return withAchievementProgress(
    stats,
    (progress) => ({
      ...progress,
      seenWorldEvents: progress.seenWorldEvents.includes(kind)
        ? progress.seenWorldEvents
        : [...progress.seenWorldEvents, kind],
    }),
    now,
  );
}

export function recordWorldSurvived(
  stats: PetStats,
  kind: PetWorldEventKind,
  now: number = Date.now(),
): PetStats {
  return withAchievementProgress(
    stats,
    (progress) => ({
      ...progress,
      survivedWorldEvents: progress.survivedWorldEvents.includes(kind)
        ? progress.survivedWorldEvents
        : [...progress.survivedWorldEvents, kind],
    }),
    now,
  );
}

export function recordSynergyProgress(
  stats: PetStats,
  id: string,
  now: number = Date.now(),
): PetStats {
  return withAchievementProgress(
    stats,
    (progress) => ({
      ...progress,
      synergyIds: progress.synergyIds.includes(id)
        ? progress.synergyIds
        : [...progress.synergyIds, id],
    }),
    now,
  );
}

// Decay over (now - stats.lastSaved). Works the same on a 1-minute
// tick during an active session and on resume after a multi-hour OS
// suspend — both cases compute the exact delta since the timestamp
// was last bumped. `now` is injectable so React state updaters can stay
// deterministic under StrictMode double-invocation. `multiplier` ∈
// [0,1] scales the per-hour rate so perks / world modifiers / session
// presence compose into a single effective rate (V60).
export function applyDecay(
  stats: PetStats,
  now: number = Date.now(),
  multiplier: number = 1,
): PetStats {
  const elapsed = Math.max(0, (now - stats.lastSaved) / 3_600_000);
  const safeMult =
    typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier >= 0
      ? Math.min(1, multiplier)
      : 1;
  const nextHunger = clamp(stats.hunger - DECAY_PER_HOUR.hunger * elapsed * safeMult);
  const nextHappiness = clamp(stats.happiness - DECAY_PER_HOUR.happiness * elapsed * safeMult);
  const nextEnergy = clamp(stats.energy - DECAY_PER_HOUR.energy * elapsed * safeMult);
  const nextDeals = clamp(stats.deals - DECAY_PER_HOUR.deals * elapsed * safeMult);
  if (
    nextHunger === stats.hunger &&
    nextHappiness === stats.happiness &&
    nextEnergy === stats.energy &&
    nextDeals === stats.deals
  ) {
    // No movement: return same identity so caller can skip the disk write.
    // lastSaved intentionally not bumped — next tick measures from the same
    // anchor so accumulated elapsed eventually crosses the rate threshold.
    return stats;
  }
  return {
    ...stats,
    hunger: nextHunger,
    happiness: nextHappiness,
    energy: nextEnergy,
    deals: nextDeals,
    lastSaved: now,
  };
}

export function loadPetState(): PetStats {
  try {
    const target = petFile();
    if (existsSync(target)) {
      const now = Date.now();
      const raw = readFileSync(target, "utf8");
      const parsed = JSON.parse(raw) as Partial<PetStats>;
      if (parsed.dead === true) {
        // Drexler died — reset to halfway, keep identity (name) and
        // halve lifetimeDeals so rank degrades but doesn't reset to 0
        // (V47). Death cause is now logged in the graveyard before we
        // overwrite this record.
        const priorLifetime =
          typeof parsed.lifetimeDeals === "number" && Number.isFinite(parsed.lifetimeDeals)
            ? parsed.lifetimeDeals
            : 0;
        const revived: PetStats = {
          ...defaultStats(),
          hunger: 50,
          happiness: 50,
          energy: 50,
          deals: 25,
          lifetimeDeals: Math.max(0, Math.floor(priorLifetime / 2)),
          name:
            typeof parsed.name === "string" && parsed.name.length > 0
              ? sanitizePetName(parsed.name)
              : undefined,
          // Archetype survives respawn (V61). Perks ledger does not — it is
          // tied to the rank ladder which gets halved on death, so re-earning
          // perk points starts fresh.
          archetype: parseArchetypeField(parsed.archetype),
          achievementProgress: {
            ...(parseAchievementProgress(parsed.achievementProgress, now) ??
              emptyAchievementProgress(now)),
            respawned: true,
            healthySince: now,
          },
        };
        savePetState(revived);
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
      const parsedPerks = parsePerks(parsed.perks);
      const stats: PetStats = {
        hunger: clamp(parsed.hunger, DEFAULT_STATS.hunger),
        happiness: clamp(parsed.happiness, DEFAULT_STATS.happiness),
        energy: clamp(parsed.energy, DEFAULT_STATS.energy),
        deals: clamp(parsed.deals, DEFAULT_STATS.deals),
        lastSaved: safeTimestamp(parsed.lastSaved, now),
        createdAt:
          typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
            ? parsed.createdAt
            : now,
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
        activeDeals: parseActiveDeals(parsed.activeDeals, effectiveDealCap({ perks: parsedPerks })),
        actionHistory: parseActionHistory(parsed.actionHistory),
        inventory: parsed.inventory ? normalizeInventory(parsed.inventory) : undefined,
        tradeSession: parseTradeSession(parsed.tradeSession),
        lastReviewAt:
          typeof parsed.lastReviewAt === "number" && Number.isFinite(parsed.lastReviewAt)
            ? parsed.lastReviewAt
            : undefined,
        reviewCounters: parseReviewCounters(parsed.reviewCounters),
        perks: parsedPerks,
        perkPoints:
          typeof parsed.perkPoints === "number" && Number.isFinite(parsed.perkPoints)
            ? Math.max(0, Math.floor(parsed.perkPoints))
            : undefined,
        streak: parseStreak(parsed.streak),
        dailyChallenge: parseDailyChallenge(parsed.dailyChallenge),
        worldEvent: parseWorldEvent(parsed.worldEvent),
        archetype: parseArchetypeField(parsed.archetype),
        boss: parseBoss(parsed.boss),
        minigame: parseMinigame(parsed.minigame),
        achievementProgress: parseAchievementProgress(parsed.achievementProgress, now),
      };
      return applyDecay(stats, now);
    }
  } catch {
    // fall through to defaults
  }
  return defaultStats();
}

function readLockRecord(lockPath: string): PetLockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<PetLockRecord>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.hostname === "string"
    ) {
      return {
        pid: parsed.pid,
        token: parsed.token,
        createdAt: parsed.createdAt,
        hostname: parsed.hostname,
      };
    }
  } catch {
    // Invalid or unreadable lockfiles are handled by mtime-based staleness below.
  }
  return null;
}

function lockCreatedAt(lockPath: string, record: PetLockRecord | null): number {
  if (record) return record.createdAt;
  try {
    return statSync(lockPath).mtimeMs;
  } catch {
    return Date.now();
  }
}

function isPidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function shouldBreakLock(lockPath: string): boolean {
  const record = readLockRecord(lockPath);
  const createdAt = lockCreatedAt(lockPath, record);
  if (Date.now() - createdAt > PET_LOCK_TTL_MS) return true;
  if (record && !isPidAlive(record.pid)) return true;
  return false;
}

function releaseOwnedLock(lockPath: string, token: string): void {
  try {
    const record = readLockRecord(lockPath);
    if (record?.token === token) {
      unlinkSync(lockPath);
    }
  } catch {
    // best-effort: lock may already be gone
  } finally {
    if (heldLockToken === token) heldLockToken = null;
  }
}

function tryAcquireLock(
  lockPath: string,
):
  | { ok: true; fd: number; token: string }
  | { ok: false; reason: "locked" | "write_failed"; message?: string } {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID();
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, "wx", 0o600);
    } catch {
      if (attempt === 0 && shouldBreakLock(lockPath)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // Another process may have raced us; treat as live contention.
        }
      }
      return { ok: false, reason: "locked", message: "pet state locked by another process" };
    }
    try {
      const record: PetLockRecord = {
        pid: process.pid,
        token,
        createdAt: Date.now(),
        hostname: hostname(),
      };
      writeFileSync(lockFd, JSON.stringify(record));
      heldLockToken = token;
      return { ok: true, fd: lockFd, token };
    } catch (err) {
      try {
        closeSync(lockFd);
      } catch {
        // best-effort: fd may already be closed
      }
      releaseOwnedLock(lockPath, token);
      return {
        ok: false,
        reason: "write_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: false, reason: "locked", message: "pet state locked by another process" };
}

function writePetStateAtomic(stats: PetStats): PetSaveResult {
  try {
    const dir = petDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = petFile();
    const lockPath = `${target}.lock`;
    const lock = tryAcquireLock(lockPath);
    if (!lock.ok) return lock;
    try {
      // Atomic write: temp + rename so a crash mid-write leaves the prior
      // pet.json intact rather than a truncated zero-byte file.
      const tmp = `${target}.tmp.${process.pid}.${randomUUID()}`;
      try {
        writeFileSync(tmp, JSON.stringify({ ...stats, lastSaved: Date.now() }, null, 2));
        renameSync(tmp, target);
        return { ok: true };
      } catch {
        try {
          unlinkSync(tmp);
        } catch {
          // best-effort: tmp may already be unlinked or never created (§V29)
        }
        return { ok: false, reason: "write_failed", message: "pet state write failed" };
      }
    } finally {
      try {
        closeSync(lock.fd);
      } catch {
        // best-effort: lockfd may already be closed on a partial failure (§V33)
      }
      releaseOwnedLock(lockPath, lock.token);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Indirection hook so tests can simulate a stuck/slow underlying write
// without needing to mock node:fs at the module-loader level. Default
// is the real atomic writer; tests restore the default in afterEach.
let writeImpl: (stats: PetStats) => PetSaveResult | void | Promise<PetSaveResult | void> =
  writePetStateAtomic;

export function __setPetWriteImpl(
  impl: ((stats: PetStats) => PetSaveResult | void | Promise<PetSaveResult | void>) | null,
): void {
  writeImpl = impl ?? writePetStateAtomic;
}

async function writePetStateQueued(stats: PetStats, generation: number): Promise<PetSaveResult> {
  if (generation !== queueGeneration) return { ok: false, reason: "timeout" };
  const result = await writeImpl(stats);
  if (generation !== queueGeneration) return { ok: false, reason: "timeout" };
  return result ?? { ok: true };
}

// All saves serialize through `saveQueue` (§V33). Returns a settled
// promise once this write finishes; callers may fire-and-forget. The
// default writer runs synchronous fs calls inline (so a load right
// after `savePetState` still sees the new file), but the queue
// tracks the work so `flushPetSaves()` can drain on exit (§V35).
export function savePetState(stats: PetStats): Promise<PetSaveResult> {
  const generation = queueGeneration;
  const write = () => writePetStateQueued(stats, generation);
  const next = saveQueue.then(write, write);
  const guarded = next.catch((err) => ({
    ok: false as const,
    reason: "write_failed" as const,
    message: err instanceof Error ? err.message : String(err),
  }));
  saveQueue = guarded;
  return guarded;
}

// Drain the pet save queue with a hard timeout. Used by SIGINT/SIGTERM,
// uncaughtException, and Ink unmount paths so a parallel
// `savePetState` chain finishes before the process tears down. If the
// timeout fires before the queue settles, abandon that queue generation
// without touching any lockfile owned by another process.
export function flushPetSaves(timeoutMs: number = 2000): Promise<PetSaveResult> {
  const pending = saveQueue;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
    // Don't keep the event loop alive solely for the drain timer; the
    // pending queue itself is what holds the process open.
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([pending, timeout]).then((outcome) => {
    if (timer !== null) clearTimeout(timer);
    if (outcome === "timeout") {
      // Abandon the stuck queue head so subsequent saves are not blocked
      // behind it. The queue generation prevents late older writes from
      // being treated as current, and we never delete a foreign lock here.
      queueGeneration++;
      saveQueue = Promise.resolve({ ok: true });
      return { ok: false, reason: "timeout" };
    }
    return outcome;
  });
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

// `roll` is the random branch selector for the non-precedence outcomes.
// Callers can pre-roll once and pass the same value into the reducer so
// the result is deterministic across React's StrictMode double-invoke.
export function applyVibe(
  stats: PetStats,
  roll: number = Math.random(),
): { stats: PetStats; message: string } {
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
    case "intern":
      return "Intern";
    case "analyst":
      return "Analyst";
    case "associate":
      return "Associate";
    case "vp":
      return "Vice President";
    case "md":
      return "Managing Director";
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
