import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
}

const PET_DIR = join(homedir(), ".drexler");
const PET_FILE = join(PET_DIR, "pet.json");

// Per-hour decay rates
const DECAY_PER_HOUR = {
  hunger: 15,
  happiness: 8,
  energy: 10,
  deals: 5,
};

const DEFAULT_STATS: PetStats = {
  hunger: 80,
  happiness: 75,
  energy: 85,
  deals: 30,
  lastSaved: Date.now(),
};

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function applyDecay(stats: PetStats): PetStats {
  const elapsed = (Date.now() - stats.lastSaved) / 3_600_000;
  return {
    hunger: clamp(stats.hunger - DECAY_PER_HOUR.hunger * elapsed),
    happiness: clamp(stats.happiness - DECAY_PER_HOUR.happiness * elapsed),
    energy: clamp(stats.energy - DECAY_PER_HOUR.energy * elapsed),
    deals: clamp(stats.deals - DECAY_PER_HOUR.deals * elapsed),
    lastSaved: Date.now(),
  };
}

export function loadPetState(): PetStats {
  try {
    if (existsSync(PET_FILE)) {
      const raw = readFileSync(PET_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<PetStats>;
      if (parsed.dead === true) {
        // Drexler died — reset to halfway on next startup
        writeFileSync(PET_FILE, JSON.stringify({ ...DEFAULT_STATS, hunger: 50, happiness: 50, energy: 50, deals: 25, lastSaved: Date.now() }, null, 2));
        return { hunger: 50, happiness: 50, energy: 50, deals: 25, lastSaved: Date.now() };
      }
      const stats: PetStats = {
        hunger: clamp(parsed.hunger ?? DEFAULT_STATS.hunger),
        happiness: clamp(parsed.happiness ?? DEFAULT_STATS.happiness),
        energy: clamp(parsed.energy ?? DEFAULT_STATS.energy),
        deals: clamp(parsed.deals ?? DEFAULT_STATS.deals),
        lastSaved: parsed.lastSaved ?? Date.now(),
      };
      return applyDecay(stats);
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_STATS };
}

export function savePetState(stats: PetStats): void {
  try {
    if (!existsSync(PET_DIR)) mkdirSync(PET_DIR, { recursive: true });
    writeFileSync(PET_FILE, JSON.stringify({ ...stats, lastSaved: Date.now() }, null, 2));
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

export function getPetMood(stats: PetStats): string {
  if (stats.energy < 25) return "exhausted";
  if (stats.hunger < 25) return "hungry";
  if (stats.happiness > 80) return "manic";
  if (stats.happiness < 30) return "distressed";
  if (stats.deals > 80) return "victorious";
  return "operational";
}
