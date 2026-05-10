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
          description: "Cool blue night desk",
          hint: "focused late-session work",
        },
      ],
      92,
    );

    expect(rendered).toContain("THEMES");
    expect(rendered).toContain("/theme midnight");
    expect(rendered).toContain("Cool blue night desk");
    expect(rendered).toContain("focused late-session work");
    expect(rendered.match(/Cool blue night desk/g)?.length).toBe(1);
  });

  test("renders exact theme command as a smooth chooser", () => {
    const rendered = renderPalette(
      [
        {
          name: "/theme",
          description: "Theme chooser",
          hint: "select a look below",
        },
        {
          name: "/theme apollo",
          description: "Signature Drexler green",
          hint: "default executive terminal",
        },
        {
          name: "/theme midnight",
          description: "Cool blue night desk",
          hint: "focused late-session work",
        },
      ],
      90,
      1,
    );

    expect(rendered).toContain("THEMES");
    expect(rendered).toContain("enter apply");
    expect(rendered).toContain("Theme chooser");
    expect(rendered).toContain("select a look below");
    expect(rendered).toContain("Signature Drexler green");
    expect(rendered).toContain("default executive terminal");
  });

  test("long argument command rows stay single-line and bounded", () => {
    const width = 48;
    const rendered = renderPalette(
      [
        {
          name: "/model openrouter/google/gemma-4-26b-a4b-it",
          description: "Switch to fallback boardroom model",
          hint: "stable cheaper route",
        },
      ],
      width,
    );

    expect(rendered).toContain("/model");
    expect(rendered.split("\n").filter(Boolean).length).toBeLessThanOrEqual(5);
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });
});
