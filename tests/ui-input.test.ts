import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { displayWidth } from "../src/ui/graphemes.ts";
import { InputBox } from "../src/ui/InputBox.tsx";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderInput(props: React.ComponentProps<typeof InputBox>): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: React.createElement(InputBox, props),
    }),
  ).replace(ANSI_RE, "");
}

function visibleLength(input: string): number {
  return displayWidth(input);
}

describe("InputBox", () => {
  test("renders grapheme clusters without splitting them", () => {
    const family = "👨‍👩‍👧‍👦";
    const rendered = renderInput({
      value: `A${family}B`,
      cursor: 2,
      disabled: false,
      width: 24,
    });

    expect(rendered).toContain(family);
    expect(rendered).toContain("A");
    expect(rendered).toContain("B");
  });

  test("clips long input inside narrow widths", () => {
    const rendered = renderInput({
      value: "0123456789abcdef",
      cursor: 16,
      disabled: false,
      width: 14,
    });

    expect(rendered).toContain("…");
    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(14);
    }
  });

  test("clips wide glyphs by display width", () => {
    const rendered = renderInput({
      value: "漢字かな交じり文",
      cursor: 8,
      disabled: false,
      width: 12,
    });

    expect(rendered).toContain("…");
    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(12);
    }
  });

  test("uses an unframed fallback for tiny widths with wide glyphs", () => {
    const rendered = renderInput({
      value: "A👩‍💻B",
      cursor: 1,
      disabled: false,
      width: 5,
    });

    expect(rendered).not.toContain("╭");
    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(5);
    }
  });
});
