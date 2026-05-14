import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { withJsonFileLock } from "./fileLock.ts";

export type AchievementId =
  | "first_blood"
  | "intern_to_md"
  | "audit_survivor_5"
  | "trade_winner_10"
  | "streak_7"
  | "boss_quarterly"
  | "synergy_3"
  | "pipeline_pro"
  | "cohort_2"
  | "chartered_3"
  | "pitch_perfect"
  | "negotiator"
  | "perk_collector"
  | "world_survivor"
  | "world_party"
  | "iron_will"
  | "operator_chosen"
  | "closer_chosen"
  | "networker_chosen"
  | "comeback_kid";

export interface AchievementDef {
  readonly id: AchievementId;
  readonly title: string;
  readonly description: string;
}

export const ACHIEVEMENTS: ReadonlyArray<AchievementDef> = [
  { id: "first_blood", title: "First Blood", description: "Run your first pet action." },
  { id: "intern_to_md", title: "Intern → MD", description: "Reach Managing Director rank." },
  { id: "audit_survivor_5", title: "Audit Survivor", description: "Handle 5 audit events." },
  { id: "trade_winner_10", title: "Tape Reader", description: "Win 10 /trade calls." },
  { id: "streak_7", title: "Seven & Counting", description: "Hold a 7-day action streak." },
  {
    id: "boss_quarterly",
    title: "Earnings Hero",
    description: "Beat the Quarterly Earnings boss.",
  },
  { id: "synergy_3", title: "Trifecta", description: "Trigger all 3 synergy patterns." },
  { id: "pipeline_pro", title: "Pipeline Pro", description: "Close 25 deals." },
  { id: "cohort_2", title: "Cohort", description: "Outlive 2 prior Drexler lives." },
  { id: "chartered_3", title: "Chartered", description: "Use 3 charter items." },
  { id: "pitch_perfect", title: "Pitch Perfect", description: "Win 5 /pitch mini-games." },
  { id: "negotiator", title: "Negotiator", description: "Win 5 /negotiate sessions." },
  { id: "perk_collector", title: "Perk Collector", description: "Spend 3 promotion points." },
  { id: "world_survivor", title: "World Survivor", description: "Survive a Market Crash." },
  { id: "world_party", title: "Holiday Mood", description: "Catch a Holiday world event." },
  { id: "iron_will", title: "Iron Will", description: "Live 24h without any stat below 30." },
  { id: "operator_chosen", title: "Operator", description: "Pick Operator archetype." },
  { id: "closer_chosen", title: "Closer", description: "Pick Closer archetype." },
  { id: "networker_chosen", title: "Networker", description: "Pick Networker archetype." },
  { id: "comeback_kid", title: "Comeback Kid", description: "Survive death and regain VP rank." },
];

export interface AchievementEntry {
  id: AchievementId;
  unlockedAt: number;
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function achievementsDir(): string {
  return join(getHome(), ".drexler");
}

function achievementsPath(): string {
  return join(achievementsDir(), "achievements.json");
}

// V65 — module-scope mirror of the achievements file. Lazily seeded on
// first read; invalidated on every `unlockAchievement` outcome (success
// or failure both refresh the cache from the post-write contents).
// Per-call fs reads previously cost 4–5 disk reads per pet action (B8);
// the mirror reduces hot-path overhead to a single in-memory lookup.
let achievementCache: AchievementEntry[] | null = null;
let cacheHomeKey: string | null = null;

function parseAchievementsFile(raw: string): AchievementEntry[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set<AchievementId>(ACHIEVEMENTS.map((a) => a.id));
    const out: AchievementEntry[] = [];
    const seen = new Set<AchievementId>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const id = (item as Record<string, unknown>).id;
      const at = (item as Record<string, unknown>).unlockedAt;
      if (typeof id !== "string" || !known.has(id as AchievementId)) continue;
      if (seen.has(id as AchievementId)) continue;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      seen.add(id as AchievementId);
      out.push({ id: id as AchievementId, unlockedAt: at });
    }
    return out;
  } catch {
    return [];
  }
}

function readAchievementsFromDisk(): AchievementEntry[] {
  try {
    const path = achievementsPath();
    if (!existsSync(path)) return [];
    return parseAchievementsFile(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

// Public: invalidate the cache. Useful in tests that swap $HOME between
// runs, or in long-running daemons that suspect external writes.
export function reloadAchievements(): AchievementEntry[] {
  achievementCache = readAchievementsFromDisk();
  cacheHomeKey = getHome();
  return achievementCache;
}

export function loadAchievements(): AchievementEntry[] {
  const home = getHome();
  if (achievementCache === null || cacheHomeKey !== home) {
    return reloadAchievements();
  }
  return achievementCache;
}

export type UnlockResult =
  | { ok: true; entry: AchievementEntry; def: AchievementDef }
  | { ok: false; reason: "already_unlocked" | "unknown" | "write_failed" };

export function unlockAchievement(id: AchievementId, now: number = Date.now()): UnlockResult {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return { ok: false, reason: "unknown" };
  const entry: AchievementEntry = { id, unlockedAt: now };
  let already = false;
  const wrote = withJsonFileLock<unknown[]>(achievementsPath(), [], (current) => {
    const parsed = Array.isArray(current) ? current : [];
    const known = new Set<AchievementId>(ACHIEVEMENTS.map((a) => a.id));
    const out: AchievementEntry[] = [];
    const seen = new Set<AchievementId>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      const curId = candidate.id;
      const at = candidate.unlockedAt;
      if (typeof curId !== "string" || !known.has(curId as AchievementId)) continue;
      if (seen.has(curId as AchievementId)) continue;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      seen.add(curId as AchievementId);
      out.push({ id: curId as AchievementId, unlockedAt: at });
    }
    if (seen.has(id)) {
      already = true;
      return out;
    }
    return [...out, entry];
  });
  // Cache invalidates on every outcome — `withJsonFileLock` may have
  // mutated the file even on `already_unlocked` (e.g. dedup of stale
  // entries) so the in-memory mirror must re-sync from disk.
  reloadAchievements();
  if (!wrote) {
    return { ok: false, reason: "write_failed" };
  }
  if (already) return { ok: false, reason: "already_unlocked" };
  return { ok: true, entry, def };
}

export function isAchievementUnlocked(id: AchievementId): boolean {
  return loadAchievements().some((e) => e.id === id);
}

export function renderAchievements(): string {
  const earned = loadAchievements();
  const earnedIds = new Set(earned.map((e) => e.id));
  const lines = [`Drexler badge wall — ${earned.length}/${ACHIEVEMENTS.length} earned:`];
  for (const def of ACHIEVEMENTS) {
    const mark = earnedIds.has(def.id) ? "★" : "·";
    lines.push(`  ${mark} ${def.title} — ${def.description}`);
  }
  return lines.join("\n");
}
