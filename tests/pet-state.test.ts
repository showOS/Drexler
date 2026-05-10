import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFeed,
  applyMinuteDecay,
  applyRest,
  isPetDead,
  loadPetState,
  savePetState,
} from "../src/pet/petState.ts";

describe("pet state", () => {
  let origHome: string | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "drexler-pet-"));
    origHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    await rm(dir, { recursive: true, force: true });
  });

  test("savePetState writes under the active HOME", async () => {
    savePetState({
      hunger: 70,
      happiness: 60,
      energy: 50,
      deals: 40,
      lastSaved: 1,
    });
    const raw = await readFile(join(dir, ".drexler", "pet.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.hunger).toBe(70);
    expect(parsed.happiness).toBe(60);
    expect(parsed.energy).toBe(50);
    expect(parsed.deals).toBe(40);
  });

  test("loadPetState sanitizes malformed persisted values", async () => {
    const petDir = join(dir, ".drexler");
    await mkdir(petDir, { recursive: true });
    await writeFile(
      join(petDir, "pet.json"),
      JSON.stringify({
        hunger: "not-a-number",
        happiness: null,
        energy: Number.NaN,
        deals: -20,
        lastSaved: "yesterday",
      }),
    );

    const stats = loadPetState();
    expect(stats.hunger).toBe(80);
    expect(stats.happiness).toBe(75);
    expect(stats.energy).toBe(85);
    expect(stats.deals).toBe(0);
    expect(Number.isFinite(stats.lastSaved)).toBe(true);
  });

  test("future timestamps do not increase stats through negative decay", async () => {
    const petDir = join(dir, ".drexler");
    await mkdir(petDir, { recursive: true });
    await writeFile(
      join(petDir, "pet.json"),
      JSON.stringify({
        hunger: 10,
        happiness: 20,
        energy: 30,
        deals: 40,
        lastSaved: Date.now() + 60_000,
      }),
    );

    const stats = loadPetState();
    expect(stats.hunger).toBe(10);
    expect(stats.happiness).toBe(20);
    expect(stats.energy).toBe(30);
    expect(stats.deals).toBe(40);
  });

  test("dead pet state revives to a bounded recovery state", async () => {
    const petDir = join(dir, ".drexler");
    await mkdir(petDir, { recursive: true });
    await writeFile(
      join(petDir, "pet.json"),
      JSON.stringify({
        hunger: 0,
        happiness: 0,
        energy: 0,
        deals: 0,
        lastSaved: Date.now(),
        dead: true,
      }),
    );

    const stats = loadPetState();
    expect(stats.hunger).toBe(50);
    expect(stats.happiness).toBe(50);
    expect(stats.energy).toBe(50);
    expect(stats.deals).toBe(25);
    expect(isPetDead(stats)).toBe(false);
  });

  test("pet actions and decay stay within stat bounds", () => {
    const low = {
      hunger: 95,
      happiness: 98,
      energy: 90,
      deals: 95,
      lastSaved: Date.now(),
    };
    expect(applyFeed(low).hunger).toBe(100);
    expect(applyRest(low).energy).toBe(100);

    const decayed = applyMinuteDecay({
      hunger: 0.1,
      happiness: 0.1,
      energy: 0.1,
      deals: 0.1,
      lastSaved: Date.now(),
    });
    expect(decayed.hunger).toBeGreaterThanOrEqual(0);
    expect(decayed.happiness).toBeGreaterThanOrEqual(0);
    expect(decayed.energy).toBeGreaterThanOrEqual(0);
    expect(decayed.deals).toBeGreaterThanOrEqual(0);
  });
});
