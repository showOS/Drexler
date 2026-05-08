import { describe, expect, test } from "bun:test";
import { MOODS, moodLine, pickMood } from "../src/mood.ts";

describe("MOODS", () => {
  test("has at least 3 distinct moods", () => {
    expect(MOODS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(MOODS).size).toBe(MOODS.length);
  });

  test("all moods are non-empty lowercase words", () => {
    for (const m of MOODS) {
      const s: string = m;
      expect(s.length).toBeGreaterThan(0);
      expect(s).toBe(s.toLowerCase());
      expect(s).not.toMatch(/\s/);
    }
  });
});

describe("pickMood", () => {
  test("returns a value from MOODS", () => {
    for (let i = 0; i < 20; i++) {
      expect(MOODS).toContain(pickMood());
    }
  });
});

describe("moodLine", () => {
  test("includes the mood string", () => {
    const line = moodLine("paranoid");
    expect(line).toContain("paranoid");
  });

  test("starts with separator and tags as system reminder", () => {
    const line = moodLine("manic");
    expect(line).toMatch(/Today's Drexler mood/);
  });

  test("emphasizes mood with bold markdown", () => {
    const line = moodLine("victorious");
    expect(line).toContain("**victorious**");
  });
});
