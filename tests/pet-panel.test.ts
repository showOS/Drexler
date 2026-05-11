import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import type { PetActivity, PetStats } from "../src/pet/petState.ts";
import {
  PET_PANEL_ROWS,
  PET_PANEL_WIDTH,
  PetPanel,
  type Environment,
} from "../src/ui/PetPanel.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderPanel(
  activity: PetActivity,
  env: Environment,
  stats: PetStats,
): string {
  return renderToString(
    React.createElement(PetPanel, { stats, activity, env }),
    { columns: PET_PANEL_WIDTH },
  ).replace(ANSI_RE, "");
}

describe("PetPanel", () => {
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
          const rendered = renderPanel(activity, env, stats);
          const rows = rendered.split("\n");

          expect(rows.length).toBe(PET_PANEL_ROWS);
          for (const row of rows) {
            expect(displayWidth(row)).toBeLessThanOrEqual(PET_PANEL_WIDTH);
          }
        }
      }
    }
  });

  test("renders 100 percent deals without breaking the office board", () => {
    const rendered = renderPanel("idle", "office", {
      hunger: 100,
      happiness: 100,
      energy: 100,
      deals: 100,
      lastSaved: 1,
    });

    expect(rendered).toContain("DL:100%");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(PET_PANEL_WIDTH);
    }
  });
});
