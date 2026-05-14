import { describe, expect, test } from "bun:test";
import { defaultRng, pick, pickInt, seededRng } from "../src/pet/rng.ts";

describe("rng helper (V66)", () => {
  test("defaultRng returns finite numbers in [0,1)", () => {
    for (let i = 0; i < 100; i++) {
      const v = defaultRng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("pickInt clamps to [0, max-1]", () => {
    expect(pickInt(() => 0, 5)).toBe(0);
    expect(pickInt(() => 0.999, 5)).toBe(4);
    expect(pickInt(() => 1.5, 5)).toBe(4);
    expect(pickInt(() => -0.5, 5)).toBe(0);
  });

  test("pickInt safe on zero/negative max", () => {
    expect(pickInt(() => 0.5, 0)).toBe(0);
    expect(pickInt(() => 0.5, -3)).toBe(0);
    expect(pickInt(() => 0.5, NaN)).toBe(0);
  });

  test("pick returns undefined on empty array", () => {
    expect(pick(defaultRng, [])).toBeUndefined();
  });

  test("pick honours rng selection", () => {
    expect(pick(() => 0, ["a", "b", "c"])).toBe("a");
    expect(pick(() => 0.5, ["a", "b", "c"])).toBe("b");
    expect(pick(() => 0.999, ["a", "b", "c"])).toBe("c");
  });

  test("seededRng is deterministic for the same seed", () => {
    const a = seededRng(1234);
    const b = seededRng(1234);
    for (let i = 0; i < 16; i++) {
      expect(a()).toBe(b());
    }
  });

  test("seededRng spreads across full [0,1)", () => {
    const rng = seededRng(0xdeadbeef);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeLessThan(0.05);
    expect(max).toBeGreaterThan(0.95);
  });
});
