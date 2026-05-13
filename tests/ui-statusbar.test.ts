import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { displayWidth } from "../src/ui/graphemes.ts";
import { StatusBar } from "../src/ui/StatusBar.tsx";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderStatusBar(props: React.ComponentProps<typeof StatusBar>): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: React.createElement(StatusBar, props),
    }),
  ).replace(ANSI_RE, "");
}

describe("StatusBar", () => {
  test("aligns the status dot with the bordered input prompt column", () => {
    const rendered = renderStatusBar({
      messageCount: 0,
      witticism: "watch leverage",
      maxWidth: 64,
    });

    expect(rendered.startsWith("  ●")).toBe(true);
  });

  test("shows transcript scroll hint when provided", () => {
    const rendered = renderStatusBar({
      messageCount: 12,
      witticism: "watch leverage",
      maxWidth: 64,
      scrollHint: "PageUp scrollback",
    });

    expect(rendered).toContain("PageUp scrollback");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(64);
    }
  });

  test("compact mode keeps scroll hint bounded", () => {
    const rendered = renderStatusBar({
      messageCount: 12,
      witticism: "watch leverage",
      maxWidth: 30,
      compact: true,
      scrollHint: "PageDown newer",
    });

    expect(rendered).toContain("PageDown");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(30);
    }
  });

  test("large counts and long hints stay on one bounded row", () => {
    const width = 34;
    const rendered = renderStatusBar({
      messageCount: 123456789,
      witticism: "a very long internal memo line that should never wrap",
      maxWidth: width,
      scrollHint: "PageUp scrollback through a long ledger",
    });

    const rows = rendered.split("\n");
    expect(rows).toHaveLength(1);
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });
});
