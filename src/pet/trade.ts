import type { PetStats, TradeSessionRecord } from "./petState.ts";

export type Ticker = "AAPL" | "MSFT" | "NVDA";
export type Side = "buy" | "sell";

export const TICKERS: ReadonlyArray<Ticker> = ["AAPL", "MSFT", "NVDA"];
export const RTH_OPEN_MINUTES = 9 * 60 + 30;
export const RTH_CLOSE_MINUTES = 16 * 60;

export const TRADE_WIN_DELTAS = { deals: 15, happiness: 10, lifetimeDeals: 5 } as const;
export const TRADE_LOSS_DELTAS = { deals: -15, happiness: -5 } as const;

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function localDateStamp(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isRTH(now: number = Date.now()): boolean {
  const d = new Date(now);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= RTH_OPEN_MINUTES && mins < RTH_CLOSE_MINUTES;
}

function tickerCode(ticker: Ticker): number {
  return TICKERS.indexOf(ticker);
}

function sideBit(side: Side): number {
  return side === "buy" ? 1 : 0;
}

// Deterministic 1-bit verdict from (date, ticker, side, seed). Cheap
// fold over the inputs that maps any combination to a single bit. Same
// pet on the same day cannot retry the same call and flip the outcome.
export function tradeWinBit(seed: number, dateStamp: string, ticker: Ticker, side: Side): number {
  let acc = seed >>> 0;
  for (let i = 0; i < dateStamp.length; i++) {
    acc = ((acc << 5) - acc + dateStamp.charCodeAt(i)) | 0;
  }
  acc ^= tickerCode(ticker) << 3;
  acc ^= sideBit(side);
  return (acc >>> 0) & 1;
}

export function ensureTradeSession(
  stats: PetStats,
  now: number,
  rng: () => number = Math.random,
): { stats: PetStats; session: TradeSessionRecord } {
  const date = localDateStamp(now);
  const existing = stats.tradeSession;
  if (existing && existing.date === date) {
    return { stats, session: existing };
  }
  const fresh: TradeSessionRecord = {
    date,
    seed: Math.floor(rng() * 0x100000000) >>> 0,
    used: false,
  };
  return { stats: { ...stats, tradeSession: fresh }, session: fresh };
}

export type TradeOutcome =
  | { ok: true; result: "win" | "loss"; stats: PetStats; message: string }
  | { ok: false; reason: "off_hours" | "already_used" | "invalid"; message: string };

export interface AttemptTradeOpts {
  now: number;
  rng?: () => number;
}

export function attemptTrade(
  stats: PetStats,
  ticker: Ticker,
  side: Side,
  opts: AttemptTradeOpts,
): TradeOutcome {
  if (!isRTH(opts.now)) {
    return {
      ok: false,
      reason: "off_hours",
      message: "After hours, partner. /trade reopens at 09:30 local.",
    };
  }
  const { stats: withSession, session } = ensureTradeSession(stats, opts.now, opts.rng);
  if (session.used && !session.bonusAvailable) {
    return {
      ok: false,
      reason: "already_used",
      message: "Drexler already placed today's order. /buy charter to unlock a bonus trade.",
    };
  }
  const bit = tradeWinBit(session.seed, session.date, ticker, side);
  const win = bit === 1;
  const consumedSession: TradeSessionRecord = session.used
    ? { ...session, bonusAvailable: false }
    : { ...session, used: true };

  let next: PetStats = { ...withSession, tradeSession: consumedSession };
  const lifetime = typeof next.lifetimeDeals === "number" ? next.lifetimeDeals : next.deals;
  if (win) {
    next = {
      ...next,
      deals: clampStat(next.deals + TRADE_WIN_DELTAS.deals),
      happiness: clampStat(next.happiness + TRADE_WIN_DELTAS.happiness),
      lifetimeDeals: lifetime + TRADE_WIN_DELTAS.lifetimeDeals,
    };
  } else {
    next = {
      ...next,
      deals: clampStat(next.deals + TRADE_LOSS_DELTAS.deals),
      happiness: clampStat(next.happiness + TRADE_LOSS_DELTAS.happiness),
    };
  }

  const verb = side === "buy" ? "bid" : "offered";
  const message = win
    ? `Drexler ${verb} ${ticker}. Tape confirms; position closed green.`
    : `Drexler ${verb} ${ticker}. Tape reverses; position closed red.`;
  return { ok: true, result: win ? "win" : "loss", stats: next, message };
}

export function parseTicker(input: string): Ticker | null {
  const up = input.toUpperCase();
  return TICKERS.includes(up as Ticker) ? (up as Ticker) : null;
}

export function parseSide(input: string): Side | null {
  const lo = input.toLowerCase();
  if (lo === "buy" || lo === "sell") return lo;
  return null;
}
