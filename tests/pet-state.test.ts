import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setPetWriteImpl,
  accrueLifetimeDeals,
  actionCooldown,
  applyDecay,
  applyFeed,
  applyName,
  applyPlay,
  applyPraise,
  applyRest,
  applyVibe,
  applyWork,
  flushPetSaves,
  formatCooldownRemaining,
  formatTenure,
  getPetMood,
  getPetRank,
  isPetDead,
  lifetimeDeals,
  loadPetState,
  PET_COOLDOWN_MS,
  petTenureMs,
  rankLabel,
  sanitizePetName,
  savePetState,
  stampAction,
  type PetStats,
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
    // Drain any in-flight async saves so a deferred write from this
    // test (e.g. loadPetState's dead-pet revive path) doesn't race a
    // subsequent test's HOME setup. saveQueue is FIFO so awaiting any
    // newly scheduled save awaits everything ahead of it.
    await savePetState({
      hunger: 0,
      happiness: 0,
      energy: 0,
      deals: 0,
      lastSaved: 0,
    });
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    await rm(dir, { recursive: true, force: true });
  });

  test("savePetState writes under the active HOME", async () => {
    await savePetState({
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

  test("applyDecay multiplier scales per-hour rate (V60)", () => {
    const baseTime = 1_700_000_000_000;
    const now = baseTime + 2 * 3_600_000;
    const halfDecayed = applyDecay(
      {
        hunger: 80,
        happiness: 80,
        energy: 80,
        deals: 80,
        lastSaved: baseTime,
      },
      now,
      0.5,
    );
    expect(halfDecayed.hunger).toBeCloseTo(65, 5);
  });

  test("applyDecay multiplier 0 disables decay; negative falls back to 1 (V60)", () => {
    const baseTime = 1_700_000_000_000;
    const now = baseTime + 5 * 3_600_000;
    const frozen = applyDecay(
      { hunger: 80, happiness: 80, energy: 80, deals: 80, lastSaved: baseTime },
      now,
      0,
    );
    expect(frozen.hunger).toBe(80);
    const fallback = applyDecay(
      { hunger: 80, happiness: 80, energy: 80, deals: 80, lastSaved: baseTime },
      now,
      -1,
    );
    expect(fallback.hunger).toBeCloseTo(5, 0);
  });

  test("PET_COOLDOWN_MS lowered to 60s (V60)", () => {
    expect(PET_COOLDOWN_MS).toBe(60_000);
  });

  test("respawn halves lifetimeDeals and keeps name (V47)", async () => {
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
        name: "Buffett",
        lifetimeDeals: 600,
      }),
    );

    const stats = loadPetState();
    expect(stats.name).toBe("Buffett");
    expect(stats.lifetimeDeals).toBe(300);
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

    // applyDecay with lastSaved=now produces ~zero elapsed → bounds hold.
    const decayed = applyDecay({
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

  test("applyDecay catches up the full elapsed window after a suspend", () => {
    // Simulate an OS suspend: lastSaved set 5 hours in the past.
    const fiveHoursAgo = Date.now() - 5 * 3_600_000;
    const decayed = applyDecay({
      hunger: 80,
      happiness: 80,
      energy: 80,
      deals: 80,
      lastSaved: fiveHoursAgo,
    });
    // DECAY_PER_HOUR.hunger = 15 → 75 over 5h → 80 - 75 = 5.
    expect(decayed.hunger).toBeCloseTo(5, 0);
    // DECAY_PER_HOUR.happiness = 8 → 40 → 80 - 40 = 40.
    expect(decayed.happiness).toBeCloseTo(40, 0);
    // lastSaved is re-stamped so the next tick measures from now.
    expect(decayed.lastSaved).toBeGreaterThanOrEqual(fiveHoursAgo);
    expect(Date.now() - decayed.lastSaved).toBeLessThan(1_000);
  });

  test("applyDecay uses injected time for deterministic updater behavior", () => {
    const baseTime = 1_700_000_000_000;
    const now = baseTime + 2 * 3_600_000;
    const decayed = applyDecay(
      {
        hunger: 80,
        happiness: 80,
        energy: 80,
        deals: 80,
        lastSaved: baseTime,
      },
      now,
    );

    expect(decayed.hunger).toBeCloseTo(50, 5);
    expect(decayed.happiness).toBeCloseTo(64, 5);
    expect(decayed.energy).toBeCloseTo(60, 5);
    expect(decayed.deals).toBeCloseTo(70, 5);
    expect(decayed.lastSaved).toBe(now);
  });

  test("applyPlay boosts happiness, costs energy, nudges deals", () => {
    const base: PetStats = {
      hunger: 80,
      happiness: 50,
      energy: 80,
      deals: 40,
      lastSaved: Date.now(),
    };
    const next = applyPlay(base);
    expect(next.happiness).toBe(70);
    expect(next.energy).toBe(70);
    expect(next.deals).toBe(45);
    expect(next.hunger).toBe(80);
  });

  test("applyWork drives deals up while spending energy and hunger", () => {
    const base: PetStats = {
      hunger: 80,
      happiness: 60,
      energy: 80,
      deals: 40,
      lastSaved: Date.now(),
    };
    const next = applyWork(base);
    expect(next.deals).toBe(60);
    expect(next.energy).toBe(65);
    expect(next.hunger).toBe(75);
    expect(next.happiness).toBe(60);
  });

  test("applyPraise only changes happiness", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 40,
      energy: 50,
      deals: 50,
      lastSaved: Date.now(),
    };
    const next = applyPraise(base);
    expect(next.happiness).toBe(55);
    expect(next.hunger).toBe(50);
    expect(next.energy).toBe(50);
    expect(next.deals).toBe(50);
  });

  test("applyVibe nap branch fires when energy < 30", () => {
    const base: PetStats = {
      hunger: 80,
      happiness: 60,
      energy: 20,
      deals: 50,
      lastSaved: Date.now(),
    };
    const { stats, message } = applyVibe(base);
    expect(stats.energy).toBe(40);
    expect(message).toMatch(/nap/);
  });

  test("applyVibe feed branch fires when hunger < 30 and energy ok", () => {
    const base: PetStats = {
      hunger: 20,
      happiness: 60,
      energy: 50,
      deals: 50,
      lastSaved: Date.now(),
    };
    const { stats, message } = applyVibe(base);
    expect(stats.hunger).toBe(45);
    expect(message).toMatch(/eats it|forgotten deal memo/);
  });

  test("applyVibe rolls through deterministic seeded branches", () => {
    const base: PetStats = {
      hunger: 80,
      happiness: 60,
      energy: 80,
      deals: 40,
      lastSaved: Date.now(),
    };
    const orig = Math.random;
    try {
      const seeds = [0.1, 0.3, 0.6, 0.9];
      const seen = new Set<string>();
      for (const s of seeds) {
        Math.random = () => s;
        const { message } = applyVibe(base);
        seen.add(message);
      }
      expect(seen.size).toBe(4);
    } finally {
      Math.random = orig;
    }
  });

  test("applyVibe returns a user-facing message for every seeded branch", () => {
    const base: PetStats = {
      hunger: 80,
      happiness: 60,
      energy: 80,
      deals: 40,
      lastSaved: Date.now(),
    };

    for (const roll of [0.1, 0.3, 0.6, 0.9]) {
      expect(applyVibe(base, roll).message.length).toBeGreaterThan(0);
    }
  });

  test("getPetMood returns each mood label across stat profiles", () => {
    const base = (overrides: Partial<PetStats>): PetStats => ({
      hunger: 60,
      happiness: 60,
      energy: 60,
      deals: 40,
      lastSaved: Date.now(),
      ...overrides,
    });
    expect(getPetMood(base({ energy: 10 }))).toBe("exhausted");
    expect(getPetMood(base({ hunger: 10 }))).toBe("hungry");
    expect(getPetMood(base({ happiness: 95 }))).toBe("manic");
    expect(getPetMood(base({ happiness: 10 }))).toBe("distressed");
    expect(getPetMood(base({ deals: 90 }))).toBe("victorious");
    expect(getPetMood(base({}))).toBe("operational");
  });

  test("isPetDead trips at the lower boundary on each fatal stat", () => {
    const live: PetStats = {
      hunger: 10,
      happiness: 10,
      energy: 10,
      deals: 10,
      lastSaved: Date.now(),
    };
    expect(isPetDead(live)).toBe(false);
    expect(isPetDead({ ...live, hunger: 0 })).toBe(true);
    expect(isPetDead({ ...live, happiness: 0 })).toBe(true);
    expect(isPetDead({ ...live, energy: 0 })).toBe(true);
    expect(isPetDead({ ...live, deals: 0 })).toBe(false);
  });

  test("repeated /feed never exceeds the upper stat bound", () => {
    let stats: PetStats = {
      hunger: 60,
      happiness: 60,
      energy: 60,
      deals: 60,
      lastSaved: Date.now(),
    };
    for (let i = 0; i < 50; i++) stats = applyFeed(stats);
    expect(stats.hunger).toBeLessThanOrEqual(100);
    expect(stats.happiness).toBeLessThanOrEqual(100);
    expect(stats.deals).toBeLessThanOrEqual(100);
  });

  test("sanitizePetName strips control chars and caps length", () => {
    expect(sanitizePetName("")).toBe("");
    expect(sanitizePetName("   ")).toBe("");
    expect(sanitizePetName("Mr. Drexler")).toBe("Mr. Drexler");
    expect(sanitizePetName("<<>>Drexler<<>>")).toBe("Drexler");
    expect(sanitizePetName("ctrl\x07char")).toBe("ctrlchar");
    expect(sanitizePetName("a".repeat(40))).toHaveLength(16);
    expect(sanitizePetName("  spaced   out  ")).toBe("spaced out");
  });

  test("sanitizePetName strips bidi overrides and zero-width controls", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE could rename "Max" to "xaM" visually.
    expect(sanitizePetName("Max‮")).toBe("Max");
    expect(sanitizePetName("‮Max")).toBe("Max");
    // Zero-width joiner, BOM, word joiner — all Cf category.
    expect(sanitizePetName("Drex​ler")).toBe("Drexler");
    expect(sanitizePetName("﻿Drexler")).toBe("Drexler");
    expect(sanitizePetName("Drex⁠ler")).toBe("Drexler");
    // Pure-invisible input collapses to empty.
    expect(sanitizePetName("​‌‍")).toBe("");
  });

  test("applyName persists sanitized name on stats", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: Date.now(),
    };
    expect(applyName(base, "Bartholomew").name).toBe("Bartholomew");
    expect(applyName(base, "   ").name).toBeUndefined();
    expect(applyName(base, "<<<>>>").name).toBeUndefined();
  });

  test("petTenureMs measures since createdAt; 0 when missing", () => {
    const now = Date.now();
    expect(
      petTenureMs(
        {
          hunger: 50,
          happiness: 50,
          energy: 50,
          deals: 50,
          lastSaved: now,
          createdAt: now - 5_000,
        },
        now,
      ),
    ).toBe(5_000);
    expect(
      petTenureMs(
        {
          hunger: 50,
          happiness: 50,
          energy: 50,
          deals: 50,
          lastSaved: now,
        },
        now,
      ),
    ).toBe(0);
  });

  test("formatTenure renders d/h/m bands", () => {
    expect(formatTenure(0)).toBe("0m");
    expect(formatTenure(30_000)).toBe("0m");
    expect(formatTenure(5 * 60_000)).toBe("5m");
    expect(formatTenure(90 * 60_000)).toBe("1h 30m");
    expect(formatTenure(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
  });

  test("savePetState + loadPetState round-trips name and createdAt", async () => {
    const created = Date.now() - 60_000;
    await savePetState({
      hunger: 70,
      happiness: 60,
      energy: 50,
      deals: 40,
      lastSaved: Date.now(),
      name: "Drexler Jr.",
      createdAt: created,
    });
    const loaded = loadPetState();
    expect(loaded.name).toBe("Drexler Jr.");
    expect(loaded.createdAt).toBe(created);
  });

  test("actionCooldown is ok when no prior action stamped", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: Date.now(),
    };
    expect(actionCooldown(base, "feed")).toEqual({ ok: true, remainingMs: 0 });
  });

  test("actionCooldown blocks within cooldown window then unblocks after", () => {
    const now = Date.now();
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: now,
    };
    const stamped = stampAction(base, "feed", now);
    const within = actionCooldown(stamped, "feed", now + 30_000);
    expect(within.ok).toBe(false);
    expect(within.remainingMs).toBeGreaterThan(0);

    const after = actionCooldown(stamped, "feed", now + PET_COOLDOWN_MS + 1);
    expect(after.ok).toBe(true);
  });

  test("actionCooldown tracks each action independently", () => {
    const now = Date.now();
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: now,
    };
    const fed = stampAction(base, "feed", now);
    expect(actionCooldown(fed, "feed", now + 10_000).ok).toBe(false);
    expect(actionCooldown(fed, "play", now + 10_000).ok).toBe(true);
  });

  test("actionCooldown unlocks when stamp is in the future (clock skew)", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: 1_000,
      lastActionAt: { feed: 5_000 },
    };
    // now=1000 < stamp=5000 → elapsed -4000. Should let the action through.
    expect(actionCooldown(base, "feed", 1_000).ok).toBe(true);
  });

  test("actionCooldown unlocks when stamp is NaN or non-finite", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: 0,
      lastActionAt: { feed: NaN, play: Infinity, work: -Infinity },
    };
    expect(actionCooldown(base, "feed", 1_000).ok).toBe(true);
    expect(actionCooldown(base, "play", 1_000).ok).toBe(true);
    expect(actionCooldown(base, "work", 1_000).ok).toBe(true);
  });

  test("formatCooldownRemaining renders seconds and minutes", () => {
    expect(formatCooldownRemaining(15_000)).toBe("15s");
    expect(formatCooldownRemaining(59_000)).toBe("59s");
    expect(formatCooldownRemaining(60_000)).toBe("1m");
    expect(formatCooldownRemaining(125_000)).toBe("2m 5s");
  });

  test("lastActionAt persists across save/load round-trips", async () => {
    const now = Date.now();
    const stats: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: now,
      lastActionAt: { feed: now - 30_000, work: now - 10_000 },
    };
    await savePetState(stats);
    const loaded = loadPetState();
    expect(loaded.lastActionAt?.feed).toBe(now - 30_000);
    expect(loaded.lastActionAt?.work).toBe(now - 10_000);
  });

  test("lifetimeDeals falls back to current deals when missing", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 42,
      lastSaved: Date.now(),
    };
    expect(lifetimeDeals(base)).toBe(42);
    expect(lifetimeDeals({ ...base, lifetimeDeals: 300 })).toBe(300);
  });

  test("getPetRank crosses every threshold", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 0,
      lastSaved: Date.now(),
    };
    expect(getPetRank({ ...base, lifetimeDeals: 0 })).toBe("intern");
    expect(getPetRank({ ...base, lifetimeDeals: 199 })).toBe("intern");
    expect(getPetRank({ ...base, lifetimeDeals: 200 })).toBe("analyst");
    expect(getPetRank({ ...base, lifetimeDeals: 400 })).toBe("associate");
    expect(getPetRank({ ...base, lifetimeDeals: 600 })).toBe("vp");
    expect(getPetRank({ ...base, lifetimeDeals: 999 })).toBe("md");
  });

  test("rankLabel renders human-friendly titles", () => {
    expect(rankLabel("intern")).toBe("Intern");
    expect(rankLabel("vp")).toBe("Vice President");
    expect(rankLabel("md")).toBe("Managing Director");
  });

  test("accrueLifetimeDeals adds per-action weight; rest/praise are free", () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: Date.now(),
      lifetimeDeals: 100,
    };
    expect(accrueLifetimeDeals(base, "work").lifetimeDeals).toBe(108);
    expect(accrueLifetimeDeals(base, "feed").lifetimeDeals).toBe(102);
    expect(accrueLifetimeDeals(base, "vibe").lifetimeDeals).toBe(103);
    expect(accrueLifetimeDeals(base, "play").lifetimeDeals).toBe(101);
    expect(accrueLifetimeDeals(base, "rest").lifetimeDeals).toBe(100);
    expect(accrueLifetimeDeals(base, "praise").lifetimeDeals).toBe(100);
  });

  test("lifetimeDeals persists across save/load round-trips", async () => {
    const now = Date.now();
    await savePetState({
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 50,
      lastSaved: now,
      lifetimeDeals: 250,
    });
    expect(loadPetState().lifetimeDeals).toBe(250);
  });

  test("20 parallel savePetState calls land final state on disk", async () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 0,
      lastSaved: Date.now(),
    };
    for (let i = 0; i < 20; i++) {
      savePetState({ ...base, deals: i });
    }
    await flushPetSaves();
    const raw = await readFile(join(dir, ".drexler", "pet.json"), "utf-8");
    const parsed = JSON.parse(raw);
    // FIFO queue lands the last scheduled call last on disk.
    expect(parsed.deals).toBe(19);
  });

  test("live foreign lock returns locked and does not unlink or overwrite", async () => {
    const petDirPath = join(dir, ".drexler");
    await mkdir(petDirPath, { recursive: true });
    const target = join(petDirPath, "pet.json");
    await writeFile(
      target,
      JSON.stringify({
        hunger: 11,
        happiness: 22,
        energy: 33,
        deals: 44,
        lastSaved: 1,
      }),
    );
    const lockPath = `${target}.lock`;
    const lock = {
      pid: process.pid,
      token: "foreign-token",
      createdAt: Date.now(),
      hostname: "other-host",
    };
    await writeFile(lockPath, JSON.stringify(lock));

    const result = await savePetState({
      hunger: 99,
      happiness: 99,
      energy: 99,
      deals: 99,
      lastSaved: 2,
    });

    expect(result).toMatchObject({ ok: false, reason: "locked" });
    expect(existsSync(lockPath)).toBe(true);
    const raw = await readFile(target, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.hunger).toBe(11);
    expect(parsed.deals).toBe(44);
  });

  test("stale lock is removed and save retries once", async () => {
    const petDirPath = join(dir, ".drexler");
    await mkdir(petDirPath, { recursive: true });
    const target = join(petDirPath, "pet.json");
    await writeFile(
      `${target}.lock`,
      JSON.stringify({
        pid: process.pid,
        token: "stale-token",
        createdAt: Date.now() - 60_000,
        hostname: "other-host",
      }),
    );

    const result = await savePetState({
      hunger: 77,
      happiness: 66,
      energy: 55,
      deals: 44,
      lastSaved: 2,
    });

    expect(result).toEqual({ ok: true });
    expect(existsSync(`${target}.lock`)).toBe(false);
    expect(JSON.parse(await readFile(target, "utf-8")).hunger).toBe(77);
  });

  test("lockfile is cleaned up after a successful save", async () => {
    await savePetState({
      hunger: 60,
      happiness: 60,
      energy: 60,
      deals: 60,
      lastSaved: Date.now(),
    });
    const lockPath = join(dir, ".drexler", "pet.json.lock");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("tmp file cleaned up when rename fails (best-effort)", async () => {
    const { readdirSync } = await import("node:fs");
    const petDirPath = join(dir, ".drexler");
    await mkdir(petDirPath, { recursive: true });
    const target = join(petDirPath, "pet.json");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "sentinel"), "x");

    const result = await savePetState({
      hunger: 70,
      happiness: 70,
      energy: 70,
      deals: 70,
      lastSaved: Date.now(),
    });
    expect(result).toMatchObject({ ok: false, reason: "write_failed" });

    const entries = readdirSync(petDirPath);
    const tmps = entries.filter((e) => e.includes(".tmp."));
    expect(tmps).toEqual([]);
    const locks = entries.filter((e) => e.endsWith(".lock"));
    expect(locks).toEqual([]);
  });

  test("flushPetSaves resolves immediately when the queue is empty", async () => {
    const started = Date.now();
    await flushPetSaves(2000);
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("flushPetSaves drains 5 parallel savePetState calls before timeout", async () => {
    const stats: PetStats = {
      hunger: 60,
      happiness: 60,
      energy: 60,
      deals: 60,
      lastSaved: Date.now(),
    };
    for (let i = 0; i < 5; i++) {
      savePetState({ ...stats, deals: 60 + i });
    }
    const started = Date.now();
    await flushPetSaves(2000);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    const raw = await readFile(join(dir, ".drexler", "pet.json"), "utf-8");
    expect(JSON.parse(raw).deals).toBe(64);
  });

  test("flushPetSaves times out gracefully without unlinking a foreign lockfile", async () => {
    const petDir = join(dir, ".drexler");
    await mkdir(petDir, { recursive: true });
    const lockPath = join(petDir, "pet.json.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        token: "foreign-token",
        createdAt: Date.now(),
        hostname: "other-host",
      }),
      "utf-8",
    );
    expect(existsSync(lockPath)).toBe(true);

    __setPetWriteImpl(() => new Promise<void>(() => {}));
    try {
      savePetState({
        hunger: 50,
        happiness: 50,
        energy: 50,
        deals: 50,
        lastSaved: Date.now(),
      });

      const started = Date.now();
      const result = await flushPetSaves(50);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(500);
      expect(result).toMatchObject({ ok: false, reason: "timeout" });
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      __setPetWriteImpl(null);
    }
  });

  test("late abandoned queue generation cannot block a newer save", async () => {
    const base: PetStats = {
      hunger: 50,
      happiness: 50,
      energy: 50,
      deals: 1,
      lastSaved: Date.now(),
    };
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    __setPetWriteImpl(async () => {
      calls++;
      if (calls === 1) await firstWrite;
      return { ok: true };
    });
    try {
      void savePetState({ ...base, deals: 1 });
      const timeout = await flushPetSaves(20);
      expect(timeout).toMatchObject({ ok: false, reason: "timeout" });
      __setPetWriteImpl(null);
      await savePetState({ ...base, deals: 2 });
      releaseFirst();
      await flushPetSaves(500);
      const raw = await readFile(join(dir, ".drexler", "pet.json"), "utf-8");
      expect(JSON.parse(raw).deals).toBe(2);
    } finally {
      releaseFirst();
      __setPetWriteImpl(null);
    }
  });
});
