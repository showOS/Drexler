import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACHIEVEMENTS,
  isAchievementUnlocked,
  loadAchievements,
  reloadAchievements,
  renderAchievements,
  unlockAchievement,
} from "../src/pet/achievements.ts";

let dir: string;
let origHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drexler-achievements-"));
  origHome = process.env.HOME;
  process.env.HOME = dir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(dir, { recursive: true, force: true });
});

describe("achievements", () => {
  test("loadAchievements tolerates missing file", () => {
    expect(loadAchievements()).toEqual([]);
  });

  test("unlockAchievement persists entry", () => {
    const r = unlockAchievement("first_blood", 1_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.def.id).toBe("first_blood");
    expect(loadAchievements().length).toBe(1);
    expect(isAchievementUnlocked("first_blood")).toBe(true);
  });

  test("re-unlock is idempotent and does not duplicate (V51)", () => {
    unlockAchievement("first_blood", 1_000);
    const second = unlockAchievement("first_blood", 2_000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_unlocked");
    expect(loadAchievements().length).toBe(1);
  });

  test("renderAchievements lists all defs", () => {
    const out = renderAchievements();
    for (const def of ACHIEVEMENTS) {
      expect(out).toContain(def.title);
    }
  });

  test("unlockAchievement rejects unknown id", () => {
    const r = unlockAchievement("nonexistent" as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown");
  });

  test("loadAchievements cache hits between unlocks (V65)", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    // First call seeds the in-memory mirror.
    reloadAchievements();
    expect(loadAchievements()).toEqual([]);
    // Mutate the underlying file directly to simulate an external write —
    // without invalidation, the cached value should still be returned.
    mkdirSync(`${dir}/.drexler`, { recursive: true });
    writeFileSync(
      `${dir}/.drexler/achievements.json`,
      JSON.stringify([{ id: "first_blood", unlockedAt: 1 }]),
    );
    expect(loadAchievements()).toEqual([]);
    // Explicit reload picks up the change.
    reloadAchievements();
    expect(isAchievementUnlocked("first_blood")).toBe(true);
  });

  test("unlockAchievement refreshes cache after write", () => {
    reloadAchievements();
    expect(isAchievementUnlocked("first_blood")).toBe(false);
    const r = unlockAchievement("first_blood", 1);
    expect(r.ok).toBe(true);
    // Cache invalidated by unlockAchievement — no manual reload needed.
    expect(isAchievementUnlocked("first_blood")).toBe(true);
  });
});
