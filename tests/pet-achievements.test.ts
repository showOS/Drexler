import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACHIEVEMENTS,
  isAchievementUnlocked,
  loadAchievements,
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
});
