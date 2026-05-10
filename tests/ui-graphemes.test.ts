import { describe, expect, test } from "bun:test";
import {
  clampCursor,
  deleteAtCursor,
  deleteBeforeCursor,
  displayWidth,
  graphemeLength,
  insertAtCursor,
  splitGraphemes,
} from "../src/ui/graphemes.ts";

describe("ui grapheme helpers", () => {
  test("counts combining marks as one cursor stop", () => {
    const text = "e\u0301x";
    expect(splitGraphemes(text)).toEqual(["e\u0301", "x"]);
    expect(graphemeLength(text)).toBe(2);
  });

  test("counts zero-width-joiner emoji as one cursor stop", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(splitGraphemes(`A${family}B`)).toEqual(["A", family, "B"]);
    expect(graphemeLength(family)).toBe(1);
  });

  test("inserts pasted text at a grapheme cursor", () => {
    const family = "👨‍👩‍👧‍👦";
    const next = insertAtCursor(`A${family}B`, 2, "e\u0301");
    expect(next).toEqual({
      value: `A${family}e\u0301B`,
      cursor: 3,
    });
  });

  test("backspace removes one full grapheme before cursor", () => {
    const family = "👨‍👩‍👧‍👦";
    const next = deleteBeforeCursor(`A${family}B`, 2);
    expect(next).toEqual({
      value: "AB",
      cursor: 1,
    });
  });

  test("delete removes one full grapheme at cursor", () => {
    const family = "👨‍👩‍👧‍👦";
    const next = deleteAtCursor(`A${family}B`, 1);
    expect(next).toEqual({
      value: "AB",
      cursor: 1,
    });
  });

  test("clamps cursor by grapheme count", () => {
    expect(clampCursor("A👩‍💻", 10)).toBe(2);
    expect(clampCursor("A👩‍💻", -4)).toBe(0);
  });

  test("estimates terminal display width for wide glyphs", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("漢")).toBe(2);
    expect(displayWidth("👩‍💻")).toBe(2);
    expect(displayWidth("e\u0301")).toBe(1);
  });
});
