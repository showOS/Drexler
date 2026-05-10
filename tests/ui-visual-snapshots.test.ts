import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { COMMAND_PALETTE } from "../src/commands.ts";
import { CommandPalette } from "../src/ui/CommandPalette.tsx";
import { DealDeskHeader } from "../src/ui/DealDeskHeader.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { InputBox } from "../src/ui/InputBox.tsx";
import { StatusBar } from "../src/ui/StatusBar.tsx";
import {
  TranscriptViewport,
  type TranscriptViewportItem,
} from "../src/ui/TranscriptViewport.tsx";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const transcriptItems: TranscriptViewportItem[] = [
  { id: 1, role: "user", content: "Need a board memo on covenant risk." },
  {
    id: 2,
    role: "assistant",
    content: "Covenant cushion acceptable. Watch liquidity, not theater.",
  },
  { id: 3, role: "system", content: "fallback openrouter/google/gemma-4-26b" },
];

function renderVisual(width: number): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.midnight,
      children: React.createElement(
        React.Fragment,
        null,
        React.createElement(DealDeskHeader, {
          model: "openrouter/google/gemma-4-31b",
          mood: "ruthless",
          messageCount: 6,
          themeName: "midnight",
          approximateTokens: 420,
          latencyMs: 835,
          status: "idle",
          notice: "PageUp scrollback",
          maxWidth: width,
          compact: width < 60,
        }),
        React.createElement(TranscriptViewport, {
          items: transcriptItems,
          maxRows: width < 60 ? 4 : 8,
          cols: width,
          compact: width < 60,
        }),
        React.createElement(CommandPalette, {
          items: COMMAND_PALETTE.slice(10, 14),
          selectedIdx: 1,
          width,
        }),
        React.createElement(InputBox, {
          value: "/export html board-memo.html",
          cursor: 28,
          disabled: false,
          width,
        }),
        React.createElement(StatusBar, {
          messageCount: 6,
          witticism: "Cash flow is argument with receipts.",
          maxWidth: width,
          scrollHint: "PageUp scrollback",
          compact: width < 60,
        }),
      ),
    }),
  ).replace(ANSI_RE, "");
}

describe("visual chrome snapshots", () => {
  test.each([
    ["wide", 96],
    ["standard", 72],
    ["narrow", 42],
  ])("%s layout keeps core UI visible and bounded", (_name, width) => {
    const rendered = renderVisual(width);

    expect(rendered).toContain("Drexler");
    expect(rendered).toContain("Covenant");
    expect(rendered).toContain("/export");
    expect(rendered).toContain("PageUp");

    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("wide visual shape stays anchored", () => {
    const rows = renderVisual(96).split("\n").filter(Boolean);

    expect(rows[0]).toContain("Drexler Deal Desk");
    expect(rows.some((row) => row.includes("DIRECTIVES"))).toBe(true);
    expect(rows.some((row) => row.includes("❯"))).toBe(true);
  });
});
