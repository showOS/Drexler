import type { PetStats } from "./petState.ts";

export type Archetype = "closer" | "networker" | "operator";

export const ARCHETYPES: ReadonlyArray<Archetype> = ["closer", "networker", "operator"];

export interface ArchetypeDef {
  readonly id: Archetype;
  readonly title: string;
  readonly description: string;
}

export const ARCHETYPE_DEFS: ReadonlyArray<ArchetypeDef> = [
  {
    id: "closer",
    title: "Closer",
    description: "Work deltas ×1.5, play deltas ×0.75. Build deals at the cost of joy.",
  },
  {
    id: "networker",
    title: "Networker",
    description: "Play deltas ×1.5, work deltas ×0.75. Charm pays.",
  },
  {
    id: "operator",
    title: "Operator",
    description: "Rest deltas ×1.5, decay ×0.9. Long-game discipline.",
  },
];

export function parseArchetype(value: string): Archetype | null {
  const lo = value.toLowerCase();
  return (ARCHETYPES as ReadonlyArray<string>).includes(lo) ? (lo as Archetype) : null;
}

export type ArchetypeOutcome =
  | { ok: true; stats: PetStats; def: ArchetypeDef }
  | { ok: false; reason: "already_set" | "unknown" | "rank_locked"; message: string };

export function chooseArchetype(
  stats: PetStats,
  id: string,
  currentRankIndex: number,
): ArchetypeOutcome {
  const archetype = parseArchetype(id);
  if (!archetype) {
    return { ok: false, reason: "unknown", message: `Unknown archetype: ${id}.` };
  }
  if (stats.archetype) {
    return {
      ok: false,
      reason: "already_set",
      message: `Archetype already locked: ${stats.archetype}.`,
    };
  }
  // VP rank index = 3 in the canonical order intern,analyst,associate,vp,md.
  if (currentRankIndex < 3) {
    return {
      ok: false,
      reason: "rank_locked",
      message: "Archetype choice unlocks at VP rank.",
    };
  }
  const def = ARCHETYPE_DEFS.find((d) => d.id === archetype)!;
  return { ok: true, stats: { ...stats, archetype }, def };
}

export interface ArchetypeMultipliers {
  work: number;
  play: number;
  rest: number;
  decay: number;
}

const NEUTRAL: ArchetypeMultipliers = { work: 1, play: 1, rest: 1, decay: 1 };

export function archetypeMultipliers(stats: PetStats): ArchetypeMultipliers {
  switch (stats.archetype) {
    case "closer":
      return { work: 1.5, play: 0.75, rest: 1, decay: 1 };
    case "networker":
      return { play: 1.5, work: 0.75, rest: 1, decay: 1 };
    case "operator":
      return { rest: 1.5, work: 1, play: 1, decay: 0.9 };
    default:
      return NEUTRAL;
  }
}

export function renderArchetypes(stats: PetStats): string {
  const lines = [
    stats.archetype
      ? `Drexler archetype locked: ${stats.archetype}.`
      : "Drexler archetype unset. Choose at VP rank.",
  ];
  for (const def of ARCHETYPE_DEFS) {
    const mark = stats.archetype === def.id ? "★" : "·";
    lines.push(`  ${mark} ${def.id} — ${def.title}: ${def.description}`);
  }
  return lines.join("\n");
}
