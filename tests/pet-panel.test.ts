import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import type { PetActivity, PetStats } from "../src/pet/petState.ts";
import { BRIEFCASE_FINAL } from "../src/ui/MascotFrame.tsx";
import {
  COMPACT_PET_PANEL_MIN_WIDTH,
  CompactPetPanel,
  PET_SCENE_ROWS,
  PET_SCENE_WIDTH,
  PetScene,
  type Environment,
} from "../src/ui/PetPanel.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const EXPECTED_SCENE_ROWS = PET_SCENE_ROWS;
const OLD_SCENE_ARTIFACTS = [
  "╔══TV════╗",
  "│ ~~~~ │",
  "╰════════╯",
  "[O]",
  " /|\\",
  " |||",
  "[home]",
  "[outdoors]",
] as const;
const BROKEN_OFFICE_SEAMS = [
  "═memo",
  "memo═",
  "╚══│",
  "│═",
  "14:…",
  "▐…",
  "pipel╭",
  "╭─eFILE",
  "═║ $$ ║═",
  "CITY WINDOW",
  "calendar clear",
  "market wall",
  "deal-room carpet shadow",
  " glow",
  "glow ",
  "╰────────╯╮",
  "DREXLER DEAL DESPIPE",
  "┄┄┄┄┄┄┄┄┄┄┄┄",
  "[IN]",
  "[OUT]",
] as const;

function renderScene(
  activity: PetActivity,
  env: Environment,
  stats: PetStats,
  width = PET_SCENE_WIDTH,
): string {
  return renderToString(
    React.createElement(PetScene, { stats, activity, env, isPaused: true, width }),
    { columns: width },
  ).replace(ANSI_RE, "");
}

function expectNoLegacyArtifacts(rendered: string): void {
  for (const artifact of OLD_SCENE_ARTIFACTS) {
    expect(rendered).not.toContain(artifact);
  }
}

function expectNoBrokenOfficeSeams(rendered: string): void {
  for (const artifact of BROKEN_OFFICE_SEAMS) {
    expect(rendered).not.toContain(artifact);
  }
}

describe("PetScene", () => {
  const activities: PetActivity[] = [
    "idle",
    "eating",
    "playing",
    "working",
    "sleeping",
    "praised",
    "vibing",
  ];
  const envs: Environment[] = ["office", "home", "outdoors"];
  const statsCases: PetStats[] = [
    { hunger: 80, happiness: 75, energy: 85, deals: 30, lastSaved: 1 },
    { hunger: 5, happiness: 5, energy: 5, deals: 5, lastSaved: 1 },
    { hunger: 100, happiness: 100, energy: 100, deals: 100, lastSaved: 1 },
  ];

  test("uses canonical mascot proportions inside an office desk scene", () => {
    const rendered = renderScene("idle", "office", statsCases[0]!, 96);

    for (const line of BRIEFCASE_FINAL.slice(0, 5)) {
      expect(rendered).toContain(line.trimEnd());
    }
    // The desk is rendered in front of the lower mascot, so the lower
    // "$$" panel remains readable without exposing the full bottom row.
    expect(rendered).toContain("║ $$ ║");
    expect(rendered).not.toContain(BRIEFCASE_FINAL[6]!.trimEnd());
    expect(rendered).toContain("DREXLER OFFICE");
    expect(rendered).toContain("╭─────────╮");
    expect(rendered).toContain("│9  ─┼─ 3 │");
    expect(rendered).toContain("DREXLER MARKETS");
    expect(rendered).toContain("BTC 67842");
    expect(rendered).toContain("╭──╮");
    expect(rendered).toMatch(/\d{2}:\d{2}/);
    expect(rendered).toContain("▐█▌");
    expect(rendered).toContain("▐░▌");
    expect(rendered).toContain("c[__]");
    expect(rendered).toContain("memo");
    expect(rendered).toContain("▄ ▄ ▄");
    expect(rendered).toContain("DREXLER DEAL DESK");
    expect(rendered).toContain("╰────┬────╯");
    expect(rendered).toContain("░░░░░░");
    expect(rendered).toContain("╭──────╮");
    expectNoLegacyArtifacts(rendered);
    expectNoBrokenOfficeSeams(rendered);
  });

  test("keeps every activity, legacy environment prop, and stat state bounded", () => {
    for (const activity of activities) {
      for (const env of envs) {
        for (const stats of statsCases) {
          const rendered = renderScene(activity, env, stats);
          const rows = rendered.split("\n");

          expect(rows.length).toBe(EXPECTED_SCENE_ROWS);
          expect(rendered).toContain("DREXLER OFFICE");
          expect(rendered).toContain("DREXLER MARKETS");
          expect(rendered).toContain("c[__]");
          expectNoLegacyArtifacts(rendered);
          expectNoBrokenOfficeSeams(rendered);
          for (const row of rows) {
            expect(displayWidth(row)).toBeLessThanOrEqual(PET_SCENE_WIDTH);
          }
        }
      }
    }
  });

  test("renders 100 percent deals without breaking the office board", () => {
    const rendered = renderScene("idle", "office", {
      hunger: 100,
      happiness: 100,
      energy: 100,
      deals: 100,
      lastSaved: 1,
    });

    expect(rendered).toContain("PIPE 100%");
    expect(rendered).toContain("FEE 99%");
    expect(rendered).toContain("DREXLER OFFICE");
    expect(rendered).toContain("DREXLER MARKETS");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(PET_SCENE_WIDTH);
    }
  });

  test.each([PET_SCENE_WIDTH, 72, 96, 108, 124, 160, 200])(
    "fills and stays bounded at %d scene columns",
    (width) => {
      const rendered = renderScene("working", "outdoors", statsCases[0]!, width);
      const rows = rendered.split("\n");

      expect(rows.length).toBe(EXPECTED_SCENE_ROWS);
      expect(rendered).toContain("DREXLER OFFICE");
      expect(rendered).toContain("DREXLER MARKETS");
      expect(rendered).toContain("EXECUTE");
      expect(rendered).toContain("memo");
      expect(rendered).toContain("▄ ▄");
      expectNoLegacyArtifacts(rendered);
      expectNoBrokenOfficeSeams(rendered);
      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );

  test("keeps desk props opaque over Drexler in sleeping mode", () => {
    const rendered = renderScene("sleeping", "office", statsCases[0]!, PET_SCENE_WIDTH);

    expect(rendered).toContain("║ ░░ ║");
    expect(rendered).toContain("│ memo ╲ │");
    expect(rendered).toContain("┌────────────┐");
    expectNoBrokenOfficeSeams(rendered);
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(PET_SCENE_WIDTH);
    }
  });

  test.each([
    [67, false, false],
    [68, true, false],
    [117, true, false],
    [118, true, true],
  ] as const)(
    "switches responsive office layout cleanly at %d columns",
    (width, expectWindow, expectStatus) => {
      const rendered = renderScene("working", "home", statsCases[0]!, width);

      expect(rendered.includes("╭──╮")).toBe(expectWindow);
      expect(rendered.includes("STATUS")).toBe(expectStatus);
      expectNoLegacyArtifacts(rendered);
      expectNoBrokenOfficeSeams(rendered);
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(width);
      }
    },
  );
});

function renderCompact(
  width: number,
  stats: PetStats,
  activity: PetActivity = "idle",
): string {
  return renderToString(
    React.createElement(CompactPetPanel, {
      stats,
      activity,
      env: "office",
      width,
    }),
    { columns: width },
  ).replace(ANSI_RE, "");
}

describe("CompactPetPanel", () => {
  test("tiny ticker surfaces the worst stat", () => {
    const rendered = renderCompact(34, {
      hunger: 80,
      happiness: 30,
      energy: 80,
      deals: 80,
      lastSaved: 1,
    });
    expect(rendered).toContain("happiness");
    expect(rendered).toContain("pet ");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(34);
    }
  });

  test("tiny ticker resolves tied low stats to hunger first", () => {
    const rendered = renderCompact(34, {
      hunger: 25,
      happiness: 25,
      energy: 25,
      deals: 25,
      lastSaved: 1,
    });
    expect(rendered).toContain("hunger");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(34);
    }
  });

  test("bordered compact panel renders stat-level labels instead of bare percentages", () => {
    const rendered = renderCompact(60, {
      hunger: 90,
      happiness: 90,
      energy: 90,
      deals: 90,
      lastSaved: 1,
    });
    expect(rendered).toContain("happy peak");
    expect(rendered).toContain("enrgy peak");
    expect(rendered).not.toContain("happy 90%");
  });

  test("renders bordered panel at the COMPACT_PET_PANEL_MIN_WIDTH threshold", () => {
    const rendered = renderCompact(COMPACT_PET_PANEL_MIN_WIDTH, {
      hunger: 60,
      happiness: 60,
      energy: 60,
      deals: 60,
      lastSaved: 1,
    });
    expect(rendered).toContain("Drexler Pet Desk");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(COMPACT_PET_PANEL_MIN_WIDTH);
    }
  });
});
