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
  computeMascotLayout,
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
const OLD_PET_SCENE_ARTIFACTS = [
  "╔══TV════╗",
  "│ ~~~~ │",
  "╰════════╯",
  "[O]",
  " /|\\",
  " |||",
  "[home]",
  "[outdoors]",
] as const;

const FINAL_STATE: MascotState = {
  walls: "on",
  brows: "normal",
  eyes: "open",
  showLock: true,
  dollars: "on",
};

describe("computeMascotLayout", () => {
  test.each([70, 80, 100, 112, 120, 140, 160, 200])(
    "produces consistent widths at %d cols",
    (width) => {
      const layout = computeMascotLayout(width);
      // Tips and Deal Desk always share width when in the same column.
      expect(layout.tips.width).toBe(layout.dealDesk.width);
      expect(layout.tips.inset).toBe(layout.dealDesk.inset);
      // Mood and copy always share width.
      expect(layout.mood.width).toBe(layout.copy.width);
      // Total occupancy never exceeds requested width.
      expect(layout.available).toBeLessThanOrEqual(width);
    },
  );

  test("split mode at width 160 aligns mood and right-column children", () => {
    const layout = computeMascotLayout(160);
    expect(layout.mode).toBe("split");
    expect(layout.rightChildWidth).toBe(layout.tips.width);
    expect(layout.rightChildWidth).toBe(layout.dealDesk.width);
    expect(
      layout.leftPanel.width + 3 + layout.rightColumn.width,
    ).toBeLessThanOrEqual(layout.innerWidth);
  });

  test("collapses to tiny / compact / stacked / split at breakpoints", () => {
    expect(computeMascotLayout(20).mode).toBe("tiny");
    expect(computeMascotLayout(70).mode).toBe("compact");
    expect(computeMascotLayout(80).mode).toBe("stacked");
    expect(computeMascotLayout(111).mode).toBe("stacked");
    expect(computeMascotLayout(112).mode).toBe("split");
  });

  test("tiny mode tips and dealDesk share parent width", () => {
    const layout = computeMascotLayout(15);
    expect(layout.mode).toBe("tiny");
    expect(layout.tips.width).toBe(layout.available);
    expect(layout.dealDesk.width).toBe(layout.available);
  });
});

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
          mood: "paranoid",
          dealDesk: (width: number) =>
            React.createElement(DealDeskHeader, {
              mood: "paranoid",
              messageCount: 6,
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
    expect(rendered).toContain("Mood");
    expect(rendered).toContain("PARANOID");
    expect(rendered).not.toContain("boot audit");
    expect(rendered).not.toContain("locked 100%");
    expect(rows[deskIdx]).toContain("╭─ Drexler");
    expect(dividerRows.length).toBeGreaterThanOrEqual(8);
    expect(rows[tipsIdx]).toContain(" │ ");
    expect(rows[deskIdx]).toContain(" │ ");
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  test("pet dashboard swaps tips and brand copy for scene and stats", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 160,
          mode: "pet",
          petActivity: "playing",
          petEnv: "home",
          petStats: {
            name: "Drex",
            hunger: 82,
            happiness: 76,
            energy: 68,
            deals: 41,
            lastSaved: 1,
            lifetimeDeals: 240,
            createdAt: Date.now() - 3600_000,
          },
        }),
      }),
      { columns: 160 },
    ).replace(ANSI_RE, "");

    expect(rendered).toContain("Drexler Pet Desk");
    expect(rendered).toContain("Pet Stats");
    expect(rendered).toContain("name Drex");
    expect(rendered).toContain("rank Analyst");
    expect(rendered).toContain("mood");
    expect(rendered).toContain("activity playing");
    expect(rendered).toContain("activity playing · office");
    expect(rendered).toContain("DREXLER OFFICE");
    expect(rendered).toContain("DESK");
    expect(rendered).toContain("laptop");
    expect(rendered).toContain("coffee");
    expect(rendered).toContain("FILE");
    expect(rendered).toContain("skyline");
    expect(rendered).toContain("happy");
    expect(rendered).toContain("hunger");
    expect(rendered).toContain("energy");
    expect(rendered).toContain("deals");
    expect(rendered).not.toContain("[home]");
    expect(rendered).not.toContain("env home");
    for (const artifact of OLD_PET_SCENE_ARTIFACTS) {
      expect(rendered).not.toContain(artifact);
    }
    expect(rendered).not.toContain("╭─ Tips");
    expect(rendered).not.toContain("Drexler Deal Desk");
    expect(rendered).not.toContain("Drexler International");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  test.each([18, 34, 48, 72, 80, 112, 160, 200])(
    "pet dashboard stays bounded at %d columns",
    (width) => {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Hello",
            width,
            mode: "pet",
            petActivity: "idle",
            petEnv: "office",
            petStats: {
              hunger: 60,
              happiness: 60,
              energy: 60,
              deals: 60,
              lastSaved: 1,
            },
          }),
        }),
        { columns: width },
      ).replace(ANSI_RE, "");

      expect(rendered).not.toContain("╭─ Tips");
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );

  test.each([112, 160, 200])(
    "pet office scene keeps canonical mascot rows bounded at %d columns",
    (width) => {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Hello",
            width,
            mode: "pet",
            petActivity: "idle",
            petEnv: "outdoors",
            petStats: {
              hunger: 60,
              happiness: 60,
              energy: 60,
              deals: 60,
              lastSaved: 1,
            },
          }),
        }),
        { columns: width },
      ).replace(ANSI_RE, "");

      for (const line of BRIEFCASE_FINAL) {
        expect(rendered).toContain(line);
      }
      expect(rendered).toContain("Drexler Pet Desk [office]");
      expect(rendered).toContain("DREXLER OFFICE");
      expect(rendered).toContain("DESK");
      expect(rendered).toContain("laptop");
      expect(rendered).toContain("coffee");
      expect(rendered).not.toContain("[outdoors]");
      expect(rendered).not.toContain("env outdoors");
      for (const artifact of OLD_PET_SCENE_ARTIFACTS) {
        expect(rendered).not.toContain(artifact);
      }
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );

  test.each([72, 80, 96, 112, 120, 160, 200])(
    "dashboard with embedded deal desk stays within %d columns",
    (width) => {
      const rendered = renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Attention everyone. Drexler convene meeting. State business.",
            width,
            mood: "victorious",
            dealDesk: (dealDeskWidth: number) =>
              React.createElement(DealDeskHeader, {
                mood: "victorious",
                messageCount: 0,
                maxWidth: Math.min(72, dealDeskWidth),
                marginBottom: 0,
              }),
          }),
        }),
        { columns: width },
      ).replace(ANSI_RE, "");

      expect(rendered.match(/Drexler Deal Desk/g)?.length).toBe(1);
      expect(rendered.match(/╭─ Tips/g)?.length).toBe(1);
      expect(rendered).toContain("Mood");
      expect(rendered).toContain("VICTORIOUS");
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );

  test("dashboard boot mood shows gauge without settled mood copy", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 120,
          mood: "ruthless",
          bootProgress: 0.4,
        }),
      }),
      { columns: 120 },
    ).replace(ANSI_RE, "");

    expect(rendered).toContain("Mood");
    expect(rendered).toContain(" 40%");
    expect(rendered).toContain("fee antenna: extending");
    expect(rendered).not.toContain("RUTHLESS");
    expect(rendered).not.toContain("FEE HAWK");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(120);
    }
  });

  test("dashboard boot mood gauge keeps a constant width across phases", () => {
    const rowsByProgress = [0.1, 0.4, 0.6, 0.9].map((bootProgress) =>
      renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Hello",
            width: 120,
            mood: "ruthless",
            bootProgress,
          }),
        }),
        { columns: 120 },
      )
        .replace(ANSI_RE, "")
        .split("\n")
        .find((row) => row.includes("[") && row.includes("%")),
    );

    expect(rowsByProgress.every(Boolean)).toBe(true);
    expect(new Set(rowsByProgress.map((row) => displayWidth(row!))).size).toBe(1);
    for (const row of rowsByProgress) {
      expect(row).not.toContain("risk sniff");
      expect(row).not.toContain("fee capture");
      expect(row).not.toContain("covenant stare");
      expect(row).not.toContain("board vote");
    }
  });

  test.each([
    "angry",
    "exhausted",
    "generous",
    "manic",
    "paranoid",
    "ruthless",
    "victorious",
  ])("dashboard settled mood maps %s to satirical copy", (mood) => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 120,
          mood,
          bootProgress: 1,
        }),
      }),
      { columns: 120 },
    ).replace(ANSI_RE, "");

    expect(rendered).toContain(mood.toUpperCase());
    expect(rendered).not.toContain("%");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(120);
    }
  });

  test("dashboard mood copy rotates for the same mood across seeds", () => {
    const originalRandom = Math.random;
    const renderWithRandom = (value: number) => {
      Math.random = () => value;
      return renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Hello",
            width: 120,
            mood: "generous",
            bootProgress: 1,
          }),
        }),
        { columns: 120 },
      ).replace(ANSI_RE, "");
    };

    try {
      const first = renderWithRandom(0);
      const second = renderWithRandom(0.000000001);

      expect(first).toContain("GENEROUS");
      expect(second).toContain("GENEROUS");
      expect(first).not.toBe(second);
      for (const rendered of [first, second]) {
        for (const row of rendered.split("\n")) {
          expect(displayWidth(row)).toBeLessThanOrEqual(120);
        }
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test.each([12, 17, 18, 20, 21, 24, 38, 42, 60, 71, 72, 111, 112])(
    "dashboard mood stays bounded at %d columns",
    (width) => {
      for (const bootProgress of [0.5, 1]) {
        const rendered = renderToString(
          React.createElement(ThemeProvider, {
            value: THEMES.apollo,
            children: React.createElement(MascotDashboard, {
              greeting: "Hello",
              width,
              mood: "aggressively contrarian deal desk posture",
              bootProgress,
            }),
          }),
          { columns: width },
        ).replace(ANSI_RE, "");

        for (const row of rendered.split("\n")) {
          expect(displayWidth(row)).toBeLessThanOrEqual(width);
        }
      }
    },
  );

  test("wide dashboard aligns mood with deal desk", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 200,
          mood: "paranoid",
          dealDesk: (dealDeskWidth: number) =>
            React.createElement(DealDeskHeader, {
              mood: "paranoid",
              messageCount: 0,
              maxWidth: dealDeskWidth,
              marginBottom: 0,
            }),
        }),
      }),
      { columns: 200 },
    ).replace(ANSI_RE, "");

    const alignedRow = rendered
      .split("\n")
      .find(
        (row) =>
          row.includes("╭─ Mood") &&
          row.includes("╭─ Drexler Deal Desk"),
      );

    expect(alignedRow).toBeDefined();
    expect(displayWidth(alignedRow!)).toBeLessThanOrEqual(200);
  });

  test("wide dashboard keeps boot and settled mood geometry stable", () => {
    const renderDashboard = (bootProgress: number) =>
      renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting: "Hello",
            width: 200,
            mood: "victorious",
            bootProgress,
            dealDesk: (dealDeskWidth: number) =>
              React.createElement(DealDeskHeader, {
                mood: "victorious",
                messageCount: 0,
                maxWidth: dealDeskWidth,
                marginBottom: 0,
              }),
          }),
        }),
        { columns: 200 },
      ).replace(ANSI_RE, "");

    const bootRows = renderDashboard(0.5).split("\n");
    const settledRows = renderDashboard(1).split("\n");
    const bootPostureIdx = bootRows.findIndex((row) =>
      row.includes("╭─ Mood"),
    );
    const settledPostureIdx = settledRows.findIndex((row) =>
      row.includes("╭─ Mood"),
    );

    expect(bootRows.length).toBe(settledRows.length);
    expect(bootPostureIdx).toBe(settledPostureIdx);
    expect(bootRows[bootPostureIdx + 1]).toContain("50%");
    expect(bootRows[bootPostureIdx + 1]).not.toContain("covenant stare");
    expect(bootRows[bootPostureIdx + 2]).toContain("counsel posture");
    expect(bootRows[bootPostureIdx + 3]).toContain("╰");
    expect(settledRows[settledPostureIdx + 1]).toContain("VICTORIOUS");
    expect(settledRows[settledPostureIdx + 2]).toContain("│");
    expect(settledRows[settledPostureIdx + 2]).not.toContain("╰");
    expect(settledRows[settledPostureIdx + 3]).toContain("╰");
    expect(bootRows[bootRows.length - 2]).toContain("╰");
    expect(settledRows[settledRows.length - 2]).toContain("╰");
    for (const rows of [bootRows, settledRows]) {
      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(200);
      }
    }
  });

  test("wide dashboard keeps mood anchored when greeting wraps", () => {
    const renderDashboard = (greeting: string) =>
      renderToString(
        React.createElement(ThemeProvider, {
          value: THEMES.apollo,
          children: React.createElement(MascotDashboard, {
            greeting,
            width: 200,
            mood: "victorious",
            dealDesk: (dealDeskWidth: number) =>
              React.createElement(DealDeskHeader, {
                mood: "victorious",
                messageCount: 0,
                maxWidth: dealDeskWidth,
                marginBottom: 0,
              }),
          }),
        }),
        { columns: 200 },
      ).replace(ANSI_RE, "");

    const shortRows = renderDashboard("Hello").split("\n");
    const wrappedRows = renderDashboard(
      "New memo to staff. Drexler accept questions for next 6 minutes. Begin.",
    ).split("\n");
    const shortMoodIdx = shortRows.findIndex((row) => row.includes("╭─ Mood"));
    const wrappedMoodIdx = wrappedRows.findIndex((row) =>
      row.includes("╭─ Mood"),
    );
    const wrappedDealDeskIdx = wrappedRows.findIndex((row) =>
      row.includes("╭─ Drexler Deal Desk"),
    );

    expect(shortMoodIdx).toBeGreaterThan(-1);
    expect(wrappedMoodIdx).toBe(shortMoodIdx);
    expect(wrappedDealDeskIdx).toBe(wrappedMoodIdx);
    expect(wrappedRows.length).toBe(shortRows.length);
    for (const row of wrappedRows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(200);
    }
  });

  test("wide dashboard keeps embedded deal desk inset symmetric", () => {
    const rendered = renderToString(
      React.createElement(ThemeProvider, {
        value: THEMES.apollo,
        children: React.createElement(MascotDashboard, {
          greeting: "Hello",
          width: 200,
          mood: "exhausted",
          dealDesk: (dealDeskWidth: number) =>
            React.createElement(DealDeskHeader, {
              mood: "exhausted",
              messageCount: 0,
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
    const deskLeft = deskRow!.indexOf("╭─ Drexler Deal Desk");
    const centerDivider = deskRow!.lastIndexOf("│", deskLeft);
    const deskRight = deskRow!.lastIndexOf("╮");
    const outerRight = deskRow!.lastIndexOf("│");

    expect(deskLeft - centerDivider - 1).toBe(2);
    expect(outerRight - deskRight - 1).toBe(2);
    expect(displayWidth(deskRow!)).toBeLessThanOrEqual(200);
  });
});
