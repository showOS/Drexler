import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { DealDeskHeader } from "../src/ui/DealDeskHeader.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderHeader(props: React.ComponentProps<typeof DealDeskHeader>): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: React.createElement(DealDeskHeader, props),
    }),
  ).replace(ANSI_RE, "");
}

function visibleLength(input: string): number {
  return displayWidth(input);
}

describe("DealDeskHeader", () => {
  test("renders premium satirical deal chrome with mood-shaped readouts", () => {
    const rendered = renderHeader({
      model: "openrouter/google/gemma-4-31b",
      mood: "distressed",
      messageCount: 7,
      status: "streaming",
      notice: "fallback armed",
      maxWidth: 96,
    });

    expect(rendered).toContain("Drexler Deal Desk");
    expect(rendered).toContain("MEMO LIVE");
    expect(rendered).toContain("7 memos");
    expect(rendered).toContain("fees ");
    expect(rendered).toContain("mandate ");
    expect(rendered).toContain("risk ");
    expect(rendered).toContain("counsel ");
    expect(rendered).toContain("memo fallback armed");
    expect(rendered).not.toContain("model openrouter/google/gemma-4-31b");
  });

  test("clamps every rendered row to the requested width", () => {
    const width = 46;
    const rendered = renderHeader({
      model: "openrouter/a-very-long-premium-frontier-model-name",
      mood: "aggressively contrarian deal desk posture",
      messageCount: 123,
      status: "idle",
      notice: "a long notice that should be trimmed before it wraps",
      maxWidth: width,
    });

    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(width);
    }
    expect(rendered).toContain("…");
  });

  test("compact mode keeps essentials and omits secondary copy", () => {
    const rendered = renderHeader({
      model: "gemma-4-31b",
      mood: "ruthless",
      messageCount: 1,
      status: "error",
      compact: true,
      notice: "should not render in compact mode",
      maxWidth: 34,
    });

    expect(rendered).toContain("Drexler");
    expect(rendered).toContain("COUN");
    expect(rendered).toContain("mood r");
    expect(rendered).not.toContain("gemma-4-31b");
    expect(rendered).not.toContain("mood ruthless");
    expect(rendered).not.toContain("should not render");
    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(34);
    }
  });

  test("tiny mode avoids framed chrome that would wrap", () => {
    const width = 12;
    const rendered = renderHeader({
      model: "gemma-4-31b",
      mood: "ruthless",
      messageCount: 42,
      status: "streaming",
      maxWidth: width,
    });

    expect(rendered).toContain("LIVE");
    expect(rendered).not.toContain("┌");
    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(width);
    }
  });

  test("same mood can render different deal desk values across sessions", () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      const first = renderHeader({
        model: "gemma-4-31b",
        mood: "angry",
        messageCount: 2,
        maxWidth: 96,
      });
      Math.random = () => 0.001;
      const second = renderHeader({
        model: "gemma-4-31b",
        mood: "angry",
        messageCount: 2,
        maxWidth: 96,
      });

      expect(first).toContain("Drexler Deal Desk");
      expect(second).toContain("Drexler Deal Desk");
      expect(first).not.toBe(second);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("display-width clamps wide glyphs", () => {
    const width = 34;
    const rendered = renderHeader({
      model: "漢字かな交じり文-model",
      mood: "victorious 🚀🚀🚀",
      messageCount: 999999,
      status: "idle",
      maxWidth: width,
    });

    for (const row of rendered.split("\n")) {
      expect(visibleLength(row)).toBeLessThanOrEqual(width);
    }
  });
});
