import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import type { SlashCommand } from "../src/commands.ts";
import { CommandPalette } from "../src/ui/CommandPalette.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderPalette(
  items: SlashCommand[],
  width: number,
  selectedIdx = 0,
): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: React.createElement(CommandPalette, {
        items,
        selectedIdx,
        width,
      }),
    }),
  ).replace(ANSI_RE, "");
}

describe("CommandPalette", () => {
  test("clips wide command rows to the requested width", () => {
    const width = 42;
    const rendered = renderPalette(
      [
        {
          name: "/export",
          description: "Export md, txt, json, or html",
        },
      ],
      width,
    );

    expect(rendered).toContain("/export");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("uses unframed compact rows for tiny terminals", () => {
    const width = 18;
    const rendered = renderPalette(
      [
        {
          name: "/save-last",
          description: "Save last Drexler response",
        },
      ],
      width,
    );

    expect(rendered).not.toContain("╭");
    expect(rendered).toContain("/save-last");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("renders argument suggestions without duplicated hint copy", () => {
    const rendered = renderPalette(
      [
        {
          name: "/theme midnight",
          description: "Switch to midnight theme",
        },
      ],
      72,
    );

    expect(rendered).toContain("/theme midnight");
    expect(rendered).toContain("Switch to midnight theme");
    expect(rendered.match(/Switch to midnight theme/g)?.length).toBe(1);
  });
});
