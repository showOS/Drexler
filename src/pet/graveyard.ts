import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { formatTenure, getPetRank, petTenureMs, rankLabel, type PetStats } from "./petState.ts";
import { withJsonFileLock } from "./fileLock.ts";

export const GRAVEYARD_CAP = 50;
export const GRAVEYARD_FILENAME = "graveyard.json";

export interface GraveyardEntry {
  name: string;
  rank: string;
  tenure: string;
  cause: string;
  diedAt: number;
  lifetimeDeals: number;
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function graveyardDir(): string {
  return join(getHome(), ".drexler");
}

function graveyardPath(): string {
  return join(graveyardDir(), GRAVEYARD_FILENAME);
}

export function loadGraveyard(): GraveyardEntry[] {
  try {
    const path = graveyardPath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: GraveyardEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (
        typeof o.name === "string" &&
        typeof o.rank === "string" &&
        typeof o.tenure === "string" &&
        typeof o.cause === "string" &&
        typeof o.diedAt === "number"
      ) {
        out.push({
          name: o.name,
          rank: o.rank,
          tenure: o.tenure,
          cause: o.cause,
          diedAt: o.diedAt,
          lifetimeDeals: typeof o.lifetimeDeals === "number" ? o.lifetimeDeals : 0,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildGraveyardEntry(
  stats: PetStats,
  cause: string,
  now: number = Date.now(),
): GraveyardEntry {
  return {
    name: stats.name ?? "(unnamed associate)",
    rank: rankLabel(getPetRank(stats)),
    tenure: formatTenure(petTenureMs(stats, now)),
    cause,
    diedAt: now,
    lifetimeDeals: typeof stats.lifetimeDeals === "number" ? stats.lifetimeDeals : stats.deals,
  };
}

export function appendGraveyardEntry(entry: GraveyardEntry): boolean {
  return withJsonFileLock<unknown[]>(graveyardPath(), [], (current) => {
    const parsed = Array.isArray(current) ? current : [];
    const out: GraveyardEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (
        typeof o.name === "string" &&
        typeof o.rank === "string" &&
        typeof o.tenure === "string" &&
        typeof o.cause === "string" &&
        typeof o.diedAt === "number"
      ) {
        out.push({
          name: o.name,
          rank: o.rank,
          tenure: o.tenure,
          cause: o.cause,
          diedAt: o.diedAt,
          lifetimeDeals: typeof o.lifetimeDeals === "number" ? o.lifetimeDeals : 0,
        });
      }
    }
    const next = [...out, entry];
    while (next.length > GRAVEYARD_CAP) next.shift();
    return next;
  });
}

export function formatGraveyardEntry(entry: GraveyardEntry): string {
  const when = new Date(entry.diedAt).toISOString().slice(0, 10);
  return `${when} · ${entry.name} (${entry.rank}, ${entry.tenure}) — ${entry.cause}`;
}

export function renderGraveyard(limit: number = 10): string {
  const entries = loadGraveyard();
  if (entries.length === 0) {
    return "Graveyard empty. Drexler has eluded mortality so far.";
  }
  const tail = entries.slice(Math.max(0, entries.length - limit));
  const lines = ["Drexler graveyard (most recent first):"];
  for (let i = tail.length - 1; i >= 0; i--) {
    lines.push(`  ${formatGraveyardEntry(tail[i]!)}`);
  }
  return lines.join("\n");
}
