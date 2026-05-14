import { describe, expect, test } from "bun:test";
import {
  TRADE_LOSS_DELTAS,
  TRADE_WIN_DELTAS,
  attemptTrade,
  ensureTradeSession,
  isRTH,
  localDateStamp,
  parseSide,
  parseTicker,
  tradeWinBit,
} from "../src/pet/trade.ts";
import type { PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    lifetimeDeals: 100,
    ...overrides,
  };
}

function rthMonday(hour: number, minute: number): number {
  // Pick a known weekday — Mon 2026-05-11 — at given local hour:minute.
  return new Date(2026, 4, 11, hour, minute, 0, 0).getTime();
}

function weekend(): number {
  return new Date(2026, 4, 9, 12, 0, 0, 0).getTime();
}

describe("market trade", () => {
  test("isRTH true in window", () => {
    expect(isRTH(rthMonday(10, 0))).toBe(true);
    expect(isRTH(rthMonday(15, 59))).toBe(true);
  });

  test("isRTH false outside window or weekend", () => {
    expect(isRTH(rthMonday(9, 0))).toBe(false);
    expect(isRTH(rthMonday(16, 0))).toBe(false);
    expect(isRTH(weekend())).toBe(false);
  });

  test("tradeWinBit deterministic for same input", () => {
    const b1 = tradeWinBit(0xabcdef, "2026-05-11", "AAPL", "buy");
    const b2 = tradeWinBit(0xabcdef, "2026-05-11", "AAPL", "buy");
    expect(b1).toBe(b2);
    expect([0, 1]).toContain(b1);
  });

  test("ensureTradeSession reuses same-date session", () => {
    const now = rthMonday(10, 0);
    const { stats: s1, session } = ensureTradeSession(baseStats(), now, () => 0.5);
    const { stats: s2, session: same } = ensureTradeSession(s1, now);
    expect(same).toBe(session);
    expect(s2).toBe(s1);
  });

  test("attemptTrade off-hours rejects without state change", () => {
    const stats = baseStats();
    const result = attemptTrade(stats, "AAPL", "buy", { now: rthMonday(8, 0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("off_hours");
  });

  test("attemptTrade applies win deltas", () => {
    const stats = baseStats({
      tradeSession: { date: localDateStamp(rthMonday(10, 0)), seed: 0xffff_ffff, used: false },
    });
    // Pick a (ticker, side) such that bit = 1 for that seed/date.
    const date = localDateStamp(rthMonday(10, 0));
    const found = ["AAPL", "MSFT", "NVDA"]
      .flatMap((t) => ["buy", "sell"].map((s) => [t, s] as const))
      .find(([t, s]) => tradeWinBit(0xffff_ffff, date, t as never, s as never) === 1);
    expect(found).toBeDefined();
    const [ticker, side] = found!;
    const result = attemptTrade(stats, ticker as never, side as never, {
      now: rthMonday(10, 0),
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.result).toBe("win");
    expect(result.stats.deals).toBe(50 + TRADE_WIN_DELTAS.deals);
    expect(result.stats.lifetimeDeals).toBe(100 + TRADE_WIN_DELTAS.lifetimeDeals);
  });

  test("attemptTrade applies loss deltas", () => {
    const stats = baseStats({
      tradeSession: { date: localDateStamp(rthMonday(10, 0)), seed: 0xffff_ffff, used: false },
    });
    const date = localDateStamp(rthMonday(10, 0));
    const found = ["AAPL", "MSFT", "NVDA"]
      .flatMap((t) => ["buy", "sell"].map((s) => [t, s] as const))
      .find(([t, s]) => tradeWinBit(0xffff_ffff, date, t as never, s as never) === 0);
    expect(found).toBeDefined();
    const [ticker, side] = found!;
    const result = attemptTrade(stats, ticker as never, side as never, {
      now: rthMonday(10, 0),
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.result).toBe("loss");
    expect(result.stats.deals).toBe(50 + TRADE_LOSS_DELTAS.deals);
    expect(result.stats.lifetimeDeals).toBe(100);
  });

  test("attemptTrade once-per-session enforced", () => {
    const now = rthMonday(10, 0);
    const stats = baseStats();
    const first = attemptTrade(stats, "AAPL", "buy", { now });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = attemptTrade(first.stats, "MSFT", "sell", { now });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_used");
  });

  test("bonus flag grants one extra trade then blocks", () => {
    const now = rthMonday(10, 0);
    const base = baseStats();
    const first = attemptTrade(base, "AAPL", "buy", { now });
    if (!first.ok) throw new Error("first failed");
    const withBonus: PetStats = {
      ...first.stats,
      tradeSession: { ...first.stats.tradeSession!, bonusAvailable: true },
    };
    const second = attemptTrade(withBonus, "MSFT", "sell", { now });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = attemptTrade(second.stats, "NVDA", "buy", { now });
    expect(third.ok).toBe(false);
  });

  test("parseTicker / parseSide reject garbage", () => {
    expect(parseTicker("aapl")).toBe("AAPL");
    expect(parseTicker("FOO")).toBeNull();
    expect(parseSide("BUY")).toBe("buy");
    expect(parseSide("hold")).toBeNull();
  });
});
