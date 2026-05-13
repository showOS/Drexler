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

// Serialize concurrent saves so the latest scheduled call lands last on
// disk. Without this, parallel rename() races mean a stale payload from
// an earlier turn can clobber the most recent at random. Mirrors the
// queue idiom in `src/conversation/persist.ts`.
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
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

// Decay over (now - stats.lastSaved). Works the same on a 1-minute
// tick during an active session and on resume after a multi-hour OS
// suspend — both cases compute the exact delta since the timestamp
// was last bumped. `now` is injectable so React state updaters can stay
// deterministic under StrictMode double-invocation.
export function applyDecay(stats: PetStats, now: number = Date.now()): PetStats {
  const elapsed = Math.max(0, (now - stats.lastSaved) / 3_600_000);
  const nextHunger = clamp(stats.hunger - DECAY_PER_HOUR.hunger * elapsed);
  const nextHappiness = clamp(stats.happiness - DECAY_PER_HOUR.happiness * elapsed);
  const nextEnergy = clamp(stats.energy - DECAY_PER_HOUR.energy * elapsed);
  const nextDeals = clamp(stats.deals - DECAY_PER_HOUR.deals * elapsed);
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
      const stats: PetStats = {
        hunger: clamp(parsed.hunger, DEFAULT_STATS.hunger),
        happiness: clamp(parsed.happiness, DEFAULT_STATS.happiness),
        energy: clamp(parsed.energy, DEFAULT_STATS.energy),
        deals: clamp(parsed.deals, DEFAULT_STATS.deals),
        lastSaved: safeTimestamp(parsed.lastSaved),
        createdAt:
          typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
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
      const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
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
