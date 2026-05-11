import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import type { PetActivity, PetStats } from "../src/pet/petState.ts";
import {
  COMPACT_PET_PANEL_MIN_WIDTH,
  CompactPetPanel,
  PET_SCENE_WIDTH,
  PetScene,
  type Environment,
} from "../src/ui/PetPanel.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const EXPECTED_SCENE_ROWS = 11;

function renderScene(
  activity: PetActivity,
  env: Environment,
  stats: PetStats,
): string {
  return renderToString(
    React.createElement(PetScene, { stats, activity, env, isPaused: true }),
    { columns: PET_SCENE_WIDTH },
  ).replace(ANSI_RE, "");
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

  test("keeps every activity, environment, and stat state bounded", () => {
    for (const activity of activities) {
      for (const env of envs) {
        for (const stats of statsCases) {
          const rendered = renderScene(activity, env, stats);
          const rows = rendered.split("\n");

          expect(rows.length).toBe(EXPECTED_SCENE_ROWS);
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

    expect(rendered).toContain("DL:100%");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(PET_SCENE_WIDTH);
    }
  });
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
