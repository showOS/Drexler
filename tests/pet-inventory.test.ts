import { describe, expect, test } from "bun:test";
import { buyItem, formatInventory, parseInventoryItem, useItem } from "../src/pet/inventory.ts";
import { INVENTORY_COSTS, type InventoryKey, type PetStats } from "../src/pet/petState.ts";
import { localDateStamp } from "../src/pet/trade.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    inventory: { coffee: 0, pastry: 0, charter: 0 },
    ...overrides,
  };
}

describe("inventory", () => {
  test("buyItem rejects insufficient deals", () => {
    const stats = baseStats({ deals: 5 });
    const r = buyItem(stats, "coffee");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insufficient_deals");
  });

  test("buyItem deducts cost and bumps inventory", () => {
    const stats = baseStats({ deals: 50 });
    const r = buyItem(stats, "coffee");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.deals).toBe(50 - INVENTORY_COSTS.coffee);
    expect(r.stats.inventory?.coffee).toBe(1);
  });

  test("useItem rejects empty", () => {
    const r = useItem(baseStats(), "coffee");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  test("coffee restores energy and signals rest cooldown clear", () => {
    const stats = baseStats({ energy: 40, inventory: { coffee: 1, pastry: 0, charter: 0 } });
    const r = useItem(stats, "coffee");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.energy).toBe(70);
    expect(r.sideEffects?.clearCooldown).toBe("rest");
    expect(r.stats.inventory?.coffee).toBe(0);
  });

  test("iron_liver increases coffee energy restore", () => {
    const stats = baseStats({
      energy: 40,
      inventory: { coffee: 1, pastry: 0, charter: 0 },
      perks: ["iron_liver"],
    });
    const r = useItem(stats, "coffee");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.energy).toBe(85);
  });

  test("pastry restores hunger and signals feed cooldown clear", () => {
    const stats = baseStats({ hunger: 40, inventory: { coffee: 0, pastry: 1, charter: 0 } });
    const r = useItem(stats, "pastry");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.hunger).toBe(70);
    expect(r.sideEffects?.clearCooldown).toBe("feed");
  });

  test("big_meals increases pastry hunger restore", () => {
    const stats = baseStats({
      hunger: 40,
      inventory: { coffee: 0, pastry: 1, charter: 0 },
      perks: ["big_meals"],
    });
    const r = useItem(stats, "pastry");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.hunger).toBe(85);
  });

  test("charter sets bonusAvailable when trade session exists", () => {
    const today = localDateStamp(Date.now());
    const stats = baseStats({
      inventory: { coffee: 0, pastry: 0, charter: 1 },
      tradeSession: { date: today, seed: 1, used: true },
    });
    const r = useItem(stats, "charter");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.tradeSession?.bonusAvailable).toBe(true);
    expect(r.sideEffects?.grantBonusTrade).toBe(true);
  });

  test("charter replaces stale used trade session with fresh today session", () => {
    const stats = baseStats({
      inventory: { coffee: 0, pastry: 0, charter: 1 },
      tradeSession: { date: "2026-05-13", seed: 1, used: true },
    });
    const now = new Date(2026, 4, 14, 10, 0).getTime();
    const r = useItem(stats, "charter", now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.tradeSession).toMatchObject({
      date: "2026-05-14",
      used: false,
      bonusAvailable: true,
    });
  });

  test("charter creates today's trade session before first trade", () => {
    const stats = baseStats({ inventory: { coffee: 0, pastry: 0, charter: 1 } });
    const r = useItem(stats, "charter");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.tradeSession?.bonusAvailable).toBe(true);
    expect(r.stats.tradeSession?.used).toBe(false);
  });

  test("parseInventoryItem accepts known + rejects unknown", () => {
    expect(parseInventoryItem("COFFEE")).toBe("coffee");
    expect(parseInventoryItem("toast")).toBeNull();
  });

  test("buyItem never goes below 0 deals", () => {
    const stats = baseStats({ deals: INVENTORY_COSTS.coffee });
    const r = buyItem(stats, "coffee");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.deals).toBe(0);
  });

  test("formatInventory lists all keys", () => {
    const out = formatInventory(baseStats({ inventory: { coffee: 2, pastry: 1, charter: 0 } }));
    expect(out).toContain("coffee ×2");
    expect(out).toContain("pastry ×1");
    expect(out).toContain("charter ×0");
  });

  test("buyItem refuses unknown item via type assertion guard", () => {
    const r = buyItem(baseStats(), "junk" as InventoryKey);
    expect(r.ok).toBe(false);
  });
});
