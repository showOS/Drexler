import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import {
  BROW_LINES,
  BRIEFCASE_FINAL,
  MascotFrame,
  MASCOT_WIDTH,
  renderMascotLines,
  type MascotState,
} from "../src/ui/MascotFrame.tsx";
import {
  INTRO_BOOT_NOTES,
  INTRO_STATUS_PREFIX,
  MascotDashboard,
  MascotIntro,
} from "../src/ui/MascotIntro.tsx";
import { DealDeskHeader } from "../src/ui/DealDeskHeader.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const FINAL_STATE: MascotState = {
  walls: "on",
  brows: "normal",
  eyes: "open",
  showLock: true,
  dollars: "on",
};

describe("MascotFrame", () => {
  test("intro boot status labels fit below the mascot without wrapping", () => {
    for (const note of INTRO_BOOT_NOTES) {
      const statusWidth = Array.from(`${INTRO_STATUS_PREFIX}${note}`).length;
      expect(statusWidth).toBeLessThanOrEqual(MASCOT_WIDTH);
    }
  });

  test("final frame matches canonical briefcase shape", () => {
    expect(renderMascotLines(FINAL_STATE)).toEqual([...BRIEFCASE_FINAL]);
  });

  test("all eyebrow animation rows fit the stable mascot canvas", () => {
    expect(BROW_LINES.normal).toBe(BRIEFCASE_FINAL[2]);
    for (const line of Object.values(BROW_LINES)) {
      expect(Array.from(line)).toHaveLength(MASCOT_WIDTH);
      expect(line.startsWith(" ║")).toBe(true);
      expect(line.endsWith("║")).toBe(true);
    }
  });

  test("all state combinations keep a stable 7x17 canvas", () => {
    const variants: MascotState[] = [];
    for (const walls of ["dim", "on"] as const) {
      for (const brows of Object.keys(BROW_LINES) as MascotState["brows"][]) {
        for (const eyes of ["hidden", "open", "closed"] as const) {
          for (const showLock of [false, true]) {
            for (const dollars of ["hidden", "dim", "on"] as const) {
              variants.push({ walls, brows, eyes, showLock, dollars });
            }
          }
        }
      }
    }

    for (const state of variants) {
      const lines = renderMascotLines(state);
      expect(lines).toHaveLength(7);
      for (const line of lines) {
        expect(Array.from(line)).toHaveLength(MASCOT_WIDTH);
      }
      expect(lines[0]).toBe(BRIEFCASE_FINAL[0]);
      expect(lines[1]).toBe(BRIEFCASE_FINAL[1]);
      expect(lines[6]).toBe(BRIEFCASE_FINAL[6]);
      for (const idx of [2, 3, 4, 5]) {
        expect(lines[idx]?.startsWith(" ║")).toBe(true);
        expect(lines[idx]?.endsWith("║")).toBe(true);
      }
    }
  });

  test("Ink rendering preserves final mascot rows without wrapping", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotFrame, FINAL_STATE),
      }),
    ).replace(ANSI_RE, "");
    const rows = rendered.split("\n");
    expect(rows).toHaveLength(7);
    expect(rows.map((line) => line.trimEnd())).toEqual(
      BRIEFCASE_FINAL.map((line) => line.trimEnd()),
    );
  });

  test("intro places boot status below the mascot frame from the first frame", () => {
    // Pin terminal width: under a real PTY `process.stdout.columns` can be 0,
    // which forces MascotIntro into its tiny-terminal text-only fallback and
    // makes the mascot frame disappear from the snapshot. 80 is wide enough
    // for full layout but below the sideBySide threshold (112).
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      value: 80,
      configurable: true,
    });
    try {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotIntro, { greeting: "Hello" }),
        }),
      ).replace(ANSI_RE, "");
      const rows = rendered.split("\n");
      const mascotBottomIdx = rows.findIndex((row) =>
        row.includes(BRIEFCASE_FINAL[6].trim()),
      );
      const bootBarIdx = rows.findIndex((row) => row.includes("▰▰▱▱"));
      const statusIdx = rows.findIndex((row) =>
        row.includes("◆ Briefcase boot"),
      );
      const brandIdx = rows.findIndex((row) =>
        row.includes("Drexler International™"),
      );

      expect(mascotBottomIdx).toBeGreaterThan(-1);
      expect(bootBarIdx).toBe(mascotBottomIdx + 1);
      expect(statusIdx).toBe(bootBarIdx + 1);
      expect(brandIdx).toBeGreaterThan(statusIdx);
      expect(rows[bootBarIdx]?.indexOf("▰")).toBe(
        rows[mascotBottomIdx]?.indexOf(BRIEFCASE_FINAL[6].trim()),
      );
      expect(rows[statusIdx]?.indexOf("◆")).toBe(
        rows[bootBarIdx]?.indexOf("▰"),
      );
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, "columns", originalColumns);
      }
    }
  });

  test("wide intro places startup tips across a vertical split", () => {
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      value: 160,
      configurable: true,
    });
    try {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotIntro, { greeting: "Hello" }),
        }),
      ).replace(ANSI_RE, "");
      const tipsLine = rendered
        .split("\n")
        .find((row) => row.includes("╭─ Tips"));

      expect(tipsLine).toBeDefined();
      expect(tipsLine?.match(/│/g)?.length).toBeGreaterThanOrEqual(2);
      expect(tipsLine?.indexOf("╭─ Tips")).toBeGreaterThan(
        tipsLine?.indexOf("│") ?? 0,
      );
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, "columns", originalColumns);
      } else {
        delete (process.stdout as { columns?: number }).columns;
      }
    }
  });

  test("wide dashboard embeds deal desk inside the tips column", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 160,
          dealDesk: (width: number) => React.createElement(DealDeskHeader, {
            model: "google/gemma-4-26b-a4b-it",
            mood: "paranoid",
            messageCount: 6,
            themeName: "apollo",
            approximateTokens: 4958,
            latencyMs: 1400,
            compact: true,
            maxWidth: Math.min(70, width),
            marginBottom: 0,
          }),
        }),
      }),
    ).replace(ANSI_RE, "");
    const rows = rendered.split("\n");
    const tipsIdx = rows.findIndex((row) => row.includes("╭─ Tips"));
    const deskIdx = rows.findIndex((row) => row.includes("╭─ Drexler"));
    const dividerRows = rows.filter((row) => row.includes(" │ "));

    expect(tipsIdx).toBeGreaterThan(-1);
    expect(deskIdx).toBeGreaterThan(tipsIdx);
    expect(rows[deskIdx]).toContain("╭─ Drexler");
    expect(dividerRows.length).toBeGreaterThanOrEqual(8);
    expect(rows[tipsIdx]).toContain(" │ ");
    expect(rows[deskIdx]).toContain(" │ ");
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  test.each([72, 80, 96, 112, 120, 160, 200])(
    "dashboard with embedded deal desk stays within %d columns",
    (width) => {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Attention everyone. Drexler convene meeting. State business.",
            width,
            dealDesk: (dealDeskWidth: number) =>
              React.createElement(DealDeskHeader, {
                model: "google/gemma-4-26b-a4b-it",
                mood: "victorious",
                messageCount: 0,
                themeName: "apollo",
                approximateTokens: 4776,
                latencyMs: null,
                maxWidth: Math.min(72, dealDeskWidth),
                marginBottom: 0,
              }),
          }),
        }),
        { columns: width },
      ).replace(ANSI_RE, "");

      expect(rendered.match(/Drexler Deal Desk/g)?.length).toBe(1);
      expect(rendered.match(/╭─ Tips/g)?.length).toBe(1);
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );

  test("wide dashboard keeps embedded deal desk inset symmetric", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 200,
          dealDesk: (dealDeskWidth: number) =>
            React.createElement(DealDeskHeader, {
              model: "google/gemma-4-26b-a4b-it",
              mood: "exhausted",
              messageCount: 0,
              themeName: "apollo",
              approximateTokens: 4776,
              maxWidth: dealDeskWidth,
              marginBottom: 0,
            }),
        }),
      }),
      { columns: 200 },
    ).replace(ANSI_RE, "");
    const deskRow = rendered
      .split("\n")
      .find((row) => row.includes("Drexler Deal Desk"));

    expect(deskRow).toBeDefined();
    const centerDivider = deskRow!.indexOf("│", 1);
    const deskLeft = deskRow!.indexOf("╭");
    const deskRight = deskRow!.lastIndexOf("╮");
    const outerRight = deskRow!.lastIndexOf("│");

    expect(deskLeft - centerDivider - 1).toBe(2);
    expect(outerRight - deskRight - 1).toBe(2);
    expect(displayWidth(deskRow!)).toBeLessThanOrEqual(200);
  });
});
