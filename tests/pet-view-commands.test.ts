import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePetViewSlash } from "../src/ui/pet/petViewCommands.ts";
import type { PetStats } from "../src/pet/petState.ts";
import { reloadAchievements } from "../src/pet/achievements.ts";

let dir: string;
let origHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drexler-view-"));
  origHome = process.env.HOME;
  process.env.HOME = dir;
  reloadAchievements();
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(dir, { recursive: true, force: true });
});

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 200,
    ...overrides,
  };
}

function recorder() {
  const lines: string[] = [];
  return {
    lines,
    addItem: (_role: "system", content: string) => lines.push(content),
  };
}

describe("handlePetViewSlash (V67)", () => {
  test("returns false for unknown slash", () => {
    const r = recorder();
    const handled = handlePetViewSlash("/unknown", {
      stats: baseStats(),
      now: 0,
      addItem: r.addItem,
    });
    expect(handled).toBe(false);
    expect(r.lines.length).toBe(0);
  });

  test("/achievements renders badge wall", () => {
    const r = recorder();
    const handled = handlePetViewSlash("/achievements", {
      stats: baseStats(),
      now: 0,
      addItem: r.addItem,
    });
    expect(handled).toBe(true);
    expect(r.lines[0]).toContain("Drexler badge wall");
  });

  test("/perks renders perks summary", () => {
    const r = recorder();
    const handled = handlePetViewSlash("/perks", {
      stats: baseStats(),
      now: 0,
      addItem: r.addItem,
    });
    expect(handled).toBe(true);
    expect(r.lines[0]).toContain("Perks");
  });

  test("/streak shows no-streak message by default", () => {
    const r = recorder();
    handlePetViewSlash("/streak", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("No active");
  });

  test("/challenge shows no-challenge message by default", () => {
    const r = recorder();
    handlePetViewSlash("/challenge", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("No daily challenge");
  });

  test("/agenda renders agenda summary", () => {
    const r = recorder();
    handlePetViewSlash("/agenda", {
      stats: baseStats(),
      now: Date.parse("2026-05-18T17:00:00Z"),
      addItem: r.addItem,
    });
    expect(r.lines[0]).toContain("Agenda");
    expect(r.lines[0]).toContain("Next:");
  });

  test("/boss renders boss detail", () => {
    const r = recorder();
    handlePetViewSlash("/boss", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("No active boss");
  });

  test("/log renders empty notification log", () => {
    const r = recorder();
    handlePetViewSlash("/log", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("empty");
  });

  test("/review formats today's snapshot", () => {
    const r = recorder();
    handlePetViewSlash("/review", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("Daily review");
  });

  test("/graveyard shows empty when no deaths recorded", () => {
    const r = recorder();
    handlePetViewSlash("/graveyard", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("empty");
  });

  test("/deals shows pipeline-empty message when no active deals", () => {
    const r = recorder();
    handlePetViewSlash("/deals", { stats: baseStats(), now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("pipeline is empty");
  });

  test("/deals lists active deals", () => {
    const stats = baseStats({
      activeDeals: [
        {
          id: "d1",
          name: "Acme",
          requirements: [{ action: "work", count: 3 }],
          deadline: 60 * 60_000,
          started: 0,
          progress: {},
          reward: 50,
        },
      ],
    });
    const r = recorder();
    handlePetViewSlash("/deals", { stats, now: 0, addItem: r.addItem });
    expect(r.lines[0]).toContain("Active deals");
    expect(r.lines[0]).toContain("Acme");
  });
});
