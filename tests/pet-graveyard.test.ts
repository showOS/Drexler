import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAVEYARD_CAP,
  appendGraveyardEntry,
  buildGraveyardEntry,
  formatGraveyardEntry,
  loadGraveyard,
  renderGraveyard,
} from "../src/pet/graveyard.ts";
import type { PetStats } from "../src/pet/petState.ts";

let dir: string;
let origHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drexler-graveyard-"));
  origHome = process.env.HOME;
  process.env.HOME = dir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(dir, { recursive: true, force: true });
});

function deadStats(name = "Drex"): PetStats {
  return {
    hunger: 0,
    happiness: 30,
    energy: 30,
    deals: 50,
    lastSaved: 0,
    name,
    createdAt: 1_000_000,
    lifetimeDeals: 250,
  };
}

describe("graveyard", () => {
  test("loadGraveyard handles missing file as empty", () => {
    expect(loadGraveyard()).toEqual([]);
  });

  test("appendGraveyardEntry persists and round-trips", () => {
    const entry = buildGraveyardEntry(deadStats("Drex"), "hunger", 5_000_000);
    const ok = appendGraveyardEntry(entry);
    expect(ok).toBe(true);
    const reloaded = loadGraveyard();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]!.name).toBe("Drex");
    expect(reloaded[0]!.cause).toBe("hunger");
    expect(reloaded[0]!.lifetimeDeals).toBe(250);
  });

  test("FIFO trim at cap", () => {
    for (let i = 0; i < GRAVEYARD_CAP + 5; i++) {
      const entry = buildGraveyardEntry(deadStats(`Drex${i}`), "test", 1_000 + i);
      appendGraveyardEntry(entry);
    }
    const entries = loadGraveyard();
    expect(entries.length).toBe(GRAVEYARD_CAP);
    expect(entries[0]!.name).toBe("Drex5");
    expect(entries.at(-1)!.name).toBe(`Drex${GRAVEYARD_CAP + 4}`);
  });

  test("formatGraveyardEntry renders date + rank + cause", () => {
    const entry = buildGraveyardEntry(
      deadStats("Marvin"),
      "boredom",
      new Date("2026-05-13T12:00:00Z").getTime(),
    );
    const out = formatGraveyardEntry(entry);
    expect(out).toContain("2026-05-13");
    expect(out).toContain("Marvin");
    expect(out).toContain("boredom");
  });

  test("renderGraveyard handles empty and populated states", () => {
    expect(renderGraveyard()).toContain("empty");
    appendGraveyardEntry(buildGraveyardEntry(deadStats("A"), "hunger", 0));
    appendGraveyardEntry(buildGraveyardEntry(deadStats("B"), "energy", 100));
    const out = renderGraveyard(10);
    expect(out).toContain("A");
    expect(out).toContain("B");
  });
});
