// §V77 — Recent-files cache.
//
// Ring buffer of ≤ 10 most-recently-attached absolute paths persisted at
// `~/.drexler/attach-recent.json`. Writes go through `withJsonFileLock`
// (§V64). Stores path strings only — never filename / mime / size / sha.
// Reads tolerate missing or corrupt files.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { withJsonFileLock } from "../pet/fileLock.ts";

const RECENT_FILENAME = "attach-recent.json";
export const MAX_RECENT_ENTRIES = 10;

function recentPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ".drexler", RECENT_FILENAME);
}

interface RecentFile {
  version: 1;
  paths: string[];
}

function parseRecent(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const v = value as Partial<RecentFile>;
  if (v.version !== 1) return [];
  if (!Array.isArray(v.paths)) return [];
  const out: string[] = [];
  for (const p of v.paths) {
    if (typeof p !== "string" || p.length === 0) continue;
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= MAX_RECENT_ENTRIES) break;
  }
  return out;
}

export function loadRecent(): string[] {
  try {
    const path = recentPath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    return parseRecent(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function pushRecent(absPath: string): void {
  if (!absPath || absPath.length === 0) return;
  withJsonFileLock<RecentFile>(
    recentPath(),
    { version: 1, paths: [] },
    (current) => {
      const existing = parseRecent(current);
      const filtered = existing.filter((p) => p !== absPath);
      const next = [absPath, ...filtered].slice(0, MAX_RECENT_ENTRIES);
      return { version: 1, paths: next };
    },
  );
}

// Filter the cache to entries whose path still resolves to a regular
// file. Used by the /attach chooser at render time so stale entries
// don't pollute the palette.
export function loadRecentValid(): string[] {
  const all = loadRecent();
  const out: string[] = [];
  for (const p of all) {
    try {
      const st = statSync(p);
      if (st.isFile()) out.push(p);
    } catch {
      // skip unreadable
    }
  }
  return out;
}
