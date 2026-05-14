import {
  INVENTORY_COSTS,
  INVENTORY_KEYS,
  emptyInventory,
  type InventoryKey,
  type PetActionKey,
  type PetInventory,
  type PetStats,
} from "./petState.ts";

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function inventoryOf(stats: PetStats): PetInventory {
  return stats.inventory ?? emptyInventory();
}

export type BuyOutcome =
  | { ok: true; stats: PetStats; message: string }
  | { ok: false; reason: "insufficient_deals" | "invalid_item"; message: string };

export function buyItem(stats: PetStats, item: InventoryKey): BuyOutcome {
  if (!INVENTORY_KEYS.includes(item)) {
    return {
      ok: false,
      reason: "invalid_item",
      message: `Item not stocked: ${item}.`,
    };
  }
  const cost = INVENTORY_COSTS[item];
  if (stats.deals < cost) {
    return {
      ok: false,
      reason: "insufficient_deals",
      message: `Need ${cost} deals, have ${Math.round(stats.deals)}. Drexler waves you off.`,
    };
  }
  const inv = inventoryOf(stats);
  const next: PetStats = {
    ...stats,
    deals: clampStat(stats.deals - cost),
    inventory: { ...inv, [item]: inv[item] + 1 },
  };
  return {
    ok: true,
    stats: next,
    message: `Drexler procures ${item}. Inventory bumped.`,
  };
}

export type UseOutcome =
  | {
      ok: true;
      stats: PetStats;
      message: string;
      sideEffects?: { clearCooldown?: PetActionKey; grantBonusTrade?: boolean };
    }
  | { ok: false; reason: "empty" | "invalid_item"; message: string };

export function useItem(stats: PetStats, item: InventoryKey): UseOutcome {
  if (!INVENTORY_KEYS.includes(item)) {
    return {
      ok: false,
      reason: "invalid_item",
      message: `Item not stocked: ${item}.`,
    };
  }
  const inv = inventoryOf(stats);
  if (inv[item] <= 0) {
    return {
      ok: false,
      reason: "empty",
      message: `No ${item} in Drexler's drawer.`,
    };
  }
  const decremented: PetInventory = { ...inv, [item]: inv[item] - 1 };
  if (item === "coffee") {
    const next: PetStats = {
      ...stats,
      energy: clampStat(stats.energy + 30),
      inventory: decremented,
    };
    return {
      ok: true,
      stats: next,
      message: "Drexler downs the coffee. Eyes refocus on the pipeline.",
      sideEffects: { clearCooldown: "rest" },
    };
  }
  if (item === "pastry") {
    const next: PetStats = {
      ...stats,
      hunger: clampStat(stats.hunger + 30),
      inventory: decremented,
    };
    return {
      ok: true,
      stats: next,
      message: "Drexler bites into the pastry. Hunger receded.",
      sideEffects: { clearCooldown: "feed" },
    };
  }
  // charter
  const session = stats.tradeSession
    ? { ...stats.tradeSession, bonusAvailable: true }
    : stats.tradeSession;
  const next: PetStats = {
    ...stats,
    inventory: decremented,
    tradeSession: session,
  };
  return {
    ok: true,
    stats: next,
    message: "Drexler logs a charter request. One bonus /trade now available this session.",
    sideEffects: { grantBonusTrade: true },
  };
}

export function parseInventoryItem(input: string): InventoryKey | null {
  const lo = input.toLowerCase();
  return INVENTORY_KEYS.includes(lo as InventoryKey) ? (lo as InventoryKey) : null;
}

export function formatInventory(stats: PetStats): string {
  const inv = inventoryOf(stats);
  return INVENTORY_KEYS.map((k) => `${k} ×${inv[k]}`).join(" · ");
}
