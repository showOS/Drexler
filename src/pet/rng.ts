// Shared RNG helper for pet-mode. V66 bans inline `Math.random()` at
// use sites; instead each consumer accepts an injectable `rng` and
// defaults to `defaultRng`. Tests inject deterministic generators.

export type Rng = () => number;

export const defaultRng: Rng = Math.random;

export function pickInt(rng: Rng, exclusiveMax: number): number {
  if (!Number.isFinite(exclusiveMax) || exclusiveMax <= 0) return 0;
  const upper = Math.floor(exclusiveMax);
  const idx = Math.floor(rng() * upper);
  if (!Number.isFinite(idx)) return 0;
  return Math.max(0, Math.min(upper - 1, idx));
}

export function pick<T>(rng: Rng, items: ReadonlyArray<T>): T | undefined {
  if (items.length === 0) return undefined;
  return items[pickInt(rng, items.length)];
}

// Returns a deterministic generator from a 32-bit seed (Mulberry32).
// Suitable for tests that want a stream of pseudo-random numbers.
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
