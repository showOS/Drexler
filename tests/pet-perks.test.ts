import { describe, expect, test } from "bun:test";
import {
  PERKS,
  grantPerkPointOnPromotion,
  hasPerk,
  parsePerkId,
  perkCoffeeBonus,
  perkCooldownReductionMs,
  perkDecayMultiplier,
  perkPipelineCap,
  perkSynergyMultiplier,
  renderPerks,
  spendPerkPoint,
} from "../src/pet/perks.ts";
import type { PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    ...overrides,
  };
}

describe("perks", () => {
  test("grantPerkPointOnPromotion adds 1 on forward step (V52)", () => {
    const stats = baseStats();
    const r = grantPerkPointOnPromotion(stats, 0, 1);
    expect(r.granted).toBe(true);
    expect(r.stats.perkPoints).toBe(1);
  });

  test("grantPerkPointOnPromotion ignores reverse + same rank", () => {
    const stats = baseStats({ perkPoints: 2 });
    const same = grantPerkPointOnPromotion(stats, 2, 2);
    const reverse = grantPerkPointOnPromotion(stats, 2, 1);
    expect(same.granted).toBe(false);
    expect(reverse.granted).toBe(false);
    expect(same.stats).toBe(stats);
    expect(reverse.stats).toBe(stats);
  });

  test("spendPerkPoint succeeds when points available + perk new", () => {
    const stats = baseStats({ perkPoints: 1 });
    const r = spendPerkPoint(stats, "slow_decay");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.perkPoints).toBe(0);
    expect(r.stats.perks).toContain("slow_decay");
  });

  test("spendPerkPoint rejects no points (V52)", () => {
    const stats = baseStats({ perkPoints: 0 });
    const r = spendPerkPoint(stats, "slow_decay");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_points");
  });

  test("spendPerkPoint rejects already owned (V52)", () => {
    const stats = baseStats({ perkPoints: 1, perks: ["slow_decay"] });
    const r = spendPerkPoint(stats, "slow_decay");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already_owned");
  });

  test("multiplier helpers map perks correctly", () => {
    const noPerks = baseStats();
    const all = baseStats({
      perks: ["slow_decay", "quick_recovery", "big_meals", "iron_liver", "rainmaker", "pipeline"],
    });
    expect(perkDecayMultiplier(noPerks)).toBe(1);
    expect(perkDecayMultiplier(all)).toBe(0.8);
    expect(perkCooldownReductionMs(noPerks)).toBe(0);
    expect(perkCooldownReductionMs(all)).toBe(30_000);
    expect(perkCoffeeBonus(noPerks)).toBe(1);
    expect(perkCoffeeBonus(all)).toBe(1.5);
    expect(perkSynergyMultiplier(noPerks)).toBe(1);
    expect(perkSynergyMultiplier(all)).toBe(1.5);
    expect(perkPipelineCap(noPerks, 2)).toBe(2);
    expect(perkPipelineCap(all, 2)).toBe(3);
  });

  test("hasPerk + parsePerkId", () => {
    expect(parsePerkId("SLOW_DECAY")).toBe("slow_decay");
    expect(parsePerkId("nope")).toBeNull();
    expect(hasPerk(baseStats({ perks: ["pipeline"] }), "pipeline")).toBe(true);
    expect(hasPerk(baseStats(), "pipeline")).toBe(false);
  });

  test("renderPerks lists all defs and shows point count", () => {
    const out = renderPerks(baseStats({ perkPoints: 2 }));
    expect(out).toContain("2 unspent");
    for (const def of PERKS) {
      expect(out).toContain(def.id);
    }
  });
});
