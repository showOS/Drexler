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
  MascotIntro,
} from "../src/ui/MascotIntro.tsx";
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
    const statusIdx = rows.findIndex((row) => row.includes("◆ Briefcase boot"));
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
    expect(rows[statusIdx]?.indexOf("◆")).toBe(rows[bootBarIdx]?.indexOf("▰"));
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
        .find((row) => row.includes("Tips for getting started"));

      expect(tipsLine).toBeDefined();
      expect(tipsLine?.match(/│/g)?.length).toBeGreaterThanOrEqual(3);
      expect(tipsLine?.indexOf("Tips for getting started")).toBeGreaterThan(
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
});
