import { Box, Text } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import { getPetMood, type PetActivity, type PetStats } from "../pet/petState.ts";
import {
  BRIEFCASE_FINAL,
  MASCOT_WIDTH,
  renderMascotLines,
  type MascotState,
} from "./MascotFrame.tsx";
import { displayWidth, fitDisplayText, splitGraphemes } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";
import { type Theme } from "./themes.ts";

export const COMPACT_PET_PANEL_ROWS = 5;
export const TINY_PET_PANEL_ROWS = 1;
export const COMPACT_PET_PANEL_MIN_WIDTH = 48;
export type Environment = "office" | "home" | "outdoors";

const PANEL_BORDER_COLUMNS = 2;
const PANEL_PADDING_COLUMNS = 2;
export const PET_SCENE_ROWS = 32;
const SCENE_ROWS = PET_SCENE_ROWS;
// Row map for the animated trading-office scene.
// 0      title bar  (DREXLER OFFICE · stat readout)
// 1-5    analog wall clock
// 6-12   city window and DREXLER MARKETS board
// 14     wall rail / office status line
// 16-22  Drexler mascot midground
// 22-29  foreground desk and props. This intentionally overlaps the
//        lower mascot rows so Drexler reads as seated behind the desk.
const R_TITLE = 0;
const R_CLOCK_TOP = 1;
const R_BOARD_TOP = 6;
const R_WIN_TOP = R_BOARD_TOP;
const R_WALL_RAIL = 14;
const R_MASCOT_START = 16;
const R_DESK_LINE = R_MASCOT_START + BRIEFCASE_FINAL.length - 1;
const R_DESK_PROPS = R_DESK_LINE + 1;
const R_FLOOR_SHADOW = SCENE_ROWS - 2;

export const PET_SCENE_WIDTH = 52;

function place(base: string, text: string, x: number): string {
  if (x < 0 || x >= base.length) return base;
  const end = Math.min(base.length, x + text.length);
  const fit = text.slice(0, end - x);
  return base.slice(0, x) + fit + base.slice(end);
}

function blankRow(width: number): string {
  return " ".repeat(width);
}

function padDisplayText(input: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const fitted = fitDisplayText(input, safeWidth);
  return `${fitted}${" ".repeat(Math.max(0, safeWidth - displayWidth(fitted)))}`;
}

function centerText(row: string, text: string): string {
  const safeText = fitDisplayText(text, row.length);
  const x = Math.max(0, Math.floor((row.length - displayWidth(safeText)) / 2));
  return place(row, safeText, x);
}

function cupForEnergy(energy: number): string {
  if (energy > 60) return "c~";
  if (energy > 30) return "c-";
  return "c_";
}

type SceneLayout = "compact" | "standard" | "wide";
type SceneState =
  | "boot"
  | "idle"
  | "working"
  | "success"
  | "error"
  | "sleep";
type StyleToken =
  | "background"
  | "primaryLine"
  | "secondaryLine"
  | "drexlerOutline"
  | "chartGrid"
  | "positiveCandle"
  | "negativeCandle"
  | "lampGlow"
  | "statusAccent";

interface Frame {
  lines: readonly string[];
  duration: number;
}

interface AnimationTimeline {
  frame: number;
  sceneState: SceneState;
}

interface Sprite {
  id: string;
  zIndex: number;
  x: number;
  y: number;
  frames: readonly Frame[];
  frameDuration: number;
  styleToken: StyleToken;
  visibility?: (timeline: AnimationTimeline) => boolean;
  parentAnchor?: string;
  transparentSpaces: boolean;
}

interface Scene {
  width: number;
  height: number;
  sprites: readonly Sprite[];
}

interface StyledCell {
  glyph: string;
  styleToken: StyleToken;
}

interface StyledSegment {
  text: string;
  styleToken: StyleToken;
}

function sceneLayout(width: number): SceneLayout {
  if (width >= 104) return "wide";
  if (width >= 68) return "standard";
  return "compact";
}

function sceneStateForActivity(activity: PetActivity): SceneState {
  switch (activity) {
    case "working":
      return "working";
    case "praised":
      return "success";
    case "sleeping":
      return "sleep";
    case "eating":
      return "boot";
    default:
      return "idle";
  }
}

function makeFrame(lines: readonly string[], duration = 1): Frame {
  return { lines, duration };
}

function makeSprite(
  id: string,
  zIndex: number,
  x: number,
  y: number,
  lines: readonly string[],
  styleToken: StyleToken,
  transparentSpaces = true,
): Sprite {
  return {
    id,
    zIndex,
    x,
    y,
    frames: [makeFrame(lines)],
    frameDuration: 1,
    styleToken,
    transparentSpaces,
  };
}

function makeAnimatedSprite({
  id,
  zIndex,
  x,
  y,
  frames,
  frameDuration,
  styleToken,
  visibility,
  parentAnchor,
  transparentSpaces = true,
}: {
  id: string;
  zIndex: number;
  x: number;
  y: number;
  frames: readonly (readonly string[])[];
  frameDuration: number;
  styleToken: StyleToken;
  visibility?: (timeline: AnimationTimeline) => boolean;
  parentAnchor?: string;
  transparentSpaces?: boolean;
}): Sprite {
  return {
    id,
    zIndex,
    x,
    y,
    frames: frames.map((lines) => makeFrame(lines, frameDuration)),
    frameDuration,
    styleToken,
    visibility,
    parentAnchor,
    transparentSpaces,
  };
}

function frameForSprite(sprite: Sprite, timeline: AnimationTimeline): readonly string[] {
  const duration = Math.max(1, sprite.frameDuration);
  const index = Math.floor(timeline.frame / duration) % sprite.frames.length;
  return sprite.frames[index]?.lines ?? [];
}

function blankCellRow(width: number, styleToken: StyleToken = "background"): StyledCell[] {
  return Array.from({ length: width }, () => ({ glyph: " ", styleToken }));
}

function overlayCellLine(
  row: StyledCell[],
  text: string,
  x: number,
  styleToken: StyleToken,
  transparentSpaces: boolean,
): void {
  if (x >= row.length) return;
  const start = Math.max(0, x);
  const available = Math.max(0, row.length - start);
  const fitted = fitDisplayText(text, available);
  let cursor = start;

  for (const glyph of splitGraphemes(fitted)) {
    if (cursor >= row.length) break;
    const glyphWidth = Math.max(1, displayWidth(glyph));
    if (glyph !== " " || !transparentSpaces) {
      row[cursor] = { glyph, styleToken };
      for (let i = 1; i < glyphWidth && cursor + i < row.length; i++) {
        row[cursor + i] = { glyph: "", styleToken };
      }
    }
    cursor += glyphWidth;
  }
}

function composeSceneCells(scene: Scene, timeline: AnimationTimeline): StyledCell[][] {
  const rows = Array.from({ length: scene.height }, () => blankCellRow(scene.width));
  const sprites = [...scene.sprites].sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.id.localeCompare(b.id);
  });

  for (const sprite of sprites) {
    if (sprite.visibility && !sprite.visibility(timeline)) continue;
    const lines = frameForSprite(sprite, timeline);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const rowIdx = sprite.y + lineIdx;
      if (rowIdx < 0 || rowIdx >= rows.length) continue;
      overlayCellLine(
        rows[rowIdx] ?? blankCellRow(scene.width),
        lines[lineIdx] ?? "",
        sprite.x,
        sprite.styleToken,
        sprite.transparentSpaces,
      );
    }
  }

  return rows;
}

function styledCellsToSegments(cells: readonly StyledCell[]): StyledSegment[] {
  const segments: StyledSegment[] = [];
  for (const cell of cells) {
    const previous = segments[segments.length - 1];
    if (previous && previous.styleToken === cell.styleToken) {
      previous.text += cell.glyph;
    } else {
      segments.push({ text: cell.glyph, styleToken: cell.styleToken });
    }
  }
  return segments;
}

function composeStyledScene(scene: Scene, timeline: AnimationTimeline): StyledSegment[][] {
  return composeSceneCells(scene, timeline).map(styledCellsToSegments);
}

function labeledRule(width: number, label: string): string {
  const safeWidth = Math.max(2, width);
  const inner = safeWidth - 2;
  const fitted = fitDisplayText(` ${label} `, inner);
  const left = Math.max(0, Math.floor((inner - displayWidth(fitted)) / 2));
  const right = Math.max(0, inner - left - displayWidth(fitted));
  return `${"─".repeat(left)}${fitted}${"─".repeat(right)}`;
}

function boxTop(width: number, label: string): string {
  return `╭${labeledRule(Math.max(2, width), label)}╮`;
}

function boxBottom(width: number): string {
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function boxContent(width: number, text: string): string {
  return `│${padDisplayText(text, Math.max(1, width - 2))}│`;
}

function mascotStateForActivity(activity: PetActivity, frame: number): MascotState {
  switch (activity) {
    case "eating":
      return {
        walls: "on",
        brows: "raised",
        eyes: "open",
        showLock: true,
        dollars: frame % 4 < 2 ? "dim" : "on",
      };
    case "playing":
      return {
        walls: "on",
        brows: frame % 6 < 3 ? "raised" : "normal",
        eyes: "open",
        showLock: true,
        dollars: "on",
      };
    case "working":
      return {
        walls: "on",
        brows: "focused",
        eyes: "open",
        showLock: true,
        dollars: frame % 8 < 4 ? "on" : "dim",
      };
    case "sleeping":
      return {
        walls: "dim",
        brows: "hidden",
        eyes: "closed",
        showLock: true,
        dollars: "dim",
      };
    case "praised":
      return {
        walls: "on",
        brows: "raised",
        eyes: "open",
        showLock: true,
        dollars: "on",
      };
    case "vibing":
      return {
        walls: "on",
        brows: "flat",
        eyes: "open",
        showLock: true,
        dollars: frame % 4 < 2 ? "dim" : "on",
      };
    default:
      return {
        walls: "on",
        brows: "normal",
        eyes: frame > 0 && frame % 22 === 0 ? "closed" : "open",
        showLock: true,
        dollars: "on",
      };
  }
}

function clockFromFrame(frame: number): string {
  // Slow ambient clock — advances roughly one minute every 5 frames.
  const startHour = 9; // boardroom opens at 9 AM corporate time.
  const totalMinutes = startHour * 60 + Math.floor(frame / 5);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function analogClockLines(frame: number): string[] {
  const hand = [
    "9  ─┼─ 3 ",
    "9   ╱  3 ",
    "9  ╶┼─ 3 ",
    "9   ╲  3 ",
  ][Math.floor(frame / 2) % 4] ?? "9  ─┼─ 3 ";
  return [
    "╭─────────╮",
    "│   12    │",
    `│${hand}│`,
    "│    6    │",
    "╰─────────╯",
  ];
}

function titleLine(width: number, stats: PetStats): string {
  const label = " DREXLER OFFICE ";
  const worst = pickWorstStat(stats);
  const readout = ` ${worst.key} ${Math.round(worst.value)}% `;
  const row = centerText("─".repeat(width), label);
  return place(
    row,
    fitDisplayText(readout, Math.max(1, width - 2)),
    Math.max(0, width - displayWidth(readout) - 1),
  );
}

function activityStatusToken(activity: PetActivity, frame: number): string {
  switch (activity) {
    case "working":
      return frame % 2 === 0 ? "EXECUTE" : "EXECUTE_";
    case "praised":
      return "DONE";
    case "sleeping":
      return "HOLD";
    case "eating":
      return "REFUEL";
    case "playing":
      return "RALLY";
    case "vibing":
      return "FLOW";
    default:
      return "WATCH";
  }
}

function cityWindowLines(width: number, frame: number): string[] {
  const sun = frame % 24 < 12 ? "-o-" : "(~)";
  const skyline = frame % 4 < 2 ? "▁▃▅▇" : "▁▃▆█";
  const cloud = frame % 6 < 3 ? "(~~)" : " (~~)";
  if (width < 20) {
    return [
      boxTop(width, "CITY WINDOW"),
      boxContent(width, `╭──╮ ${sun}`),
      boxContent(width, `│╥╥│ ${skyline}`),
      boxContent(width, "│▒▒│ lights"),
      boxContent(width, "╰──╯ tape"),
      boxBottom(width),
    ];
  }
  return [
    boxTop(width, "CITY WINDOW"),
    boxContent(width, `╭──╮ ╭──╮  ${sun} ${cloud}`),
    boxContent(width, `│╥╥│ │╤╤│  ${skyline} city`),
    boxContent(width, "│▒▒│ │░░│  lights"),
    boxContent(width, "╰──╯ ╰──╯  tape"),
    boxBottom(width),
  ];
}

function marketBoardLines(
  width: number,
  activity: PetActivity,
  frame: number,
  stats: PetStats,
): string[] {
  const status = activityStatusToken(activity, frame);
  const candleA = frame % 4 < 2 ? "▐█▌" : "▐░▌";
  const candleB = activity === "praised" ? "▐█▌" : "▐░▌";
  const finalCandle = activity === "praised" ? "▐█▌" : frame % 6 < 3 ? "▐█▌" : "▐░▌";
  const fee = Math.max(40, Math.min(99, Math.round((stats.happiness + stats.deals) / 2)));
  const chartSuffix = `${candleA} ${candleB} ${finalCandle}`;
  const chartLabel = boardTapeLabel(activity, frame);
  const footerBudget = Math.max(1, width - 2 - displayWidth(chartSuffix) - 12);
  const footer = `09:00 ${fitDisplayText(chartLabel, footerBudget)} 14:00 ${chartSuffix}`;
  const grid = "┄".repeat(Math.max(4, Math.min(14, width - 39)));
  const narrow = width < 52;
  return [
    boxTop(width, "DREXLER MARKETS"),
    boxContent(width, narrow
      ? `DREX ▲ 3.17%  ${clockFromFrame(frame)}  ${status}`
      : `DREX 0.8421 ▲ 3.17%     DEMO ${clockFromFrame(frame)}  ${status}`),
    boxContent(width, narrow
      ? `BTC 67842  FEE ${fee}%  ${grid} 69000`
      : `BTC 67842  ▲ 1.25%   FEE ${fee}% ${grid} 69000`),
    boxContent(width, narrow
      ? `ETH  3241     │   ${candleA} 68000`
      : `ETH  3241  ▲ 0.82%       │      ${candleA} 68000`),
    boxContent(width, narrow
      ? `SOL   157  ${candleB} │ ${finalCandle} 67000`
      : `SOL   157  ▲ 2.11%   ${candleB} │ ${finalCandle} ${candleA} 67000`),
    boxContent(width, footer),
    boxBottom(width),
  ];
}

function boardTapeLabel(activity: PetActivity, frame: number): string {
  switch (activity) {
    case "working":
      return frame % 2 === 0 ? "term live" : "keys live";
    case "praised":
      return "memo done";
    case "sleeping":
      return "desk quiet";
    case "eating":
      return "deal snack";
    case "playing":
      return "rally tape";
    case "vibing":
      return "lo-fi tape";
    default:
      return "desk quiet";
  }
}

function lampLines(activity: PetActivity, frame: number): string[] {
  const glow = activity === "sleeping" ? " dim " : frame % 6 < 3 ? " glow" : "glow ";
  return [
    "   ╲│╱   ",
    "  ╭───╮  ",
    " ╭╯   ╰╮ ",
    " ╰──┬──╯ ",
    "    │    ",
    `  ${fitDisplayText(glow, 5)}  `,
  ];
}

function statusCardLines(width: number, activity: PetActivity, frame: number, stats: PetStats): string[] {
  const status = activityStatusToken(activity, frame);
  const motto = activity === "working"
    ? "keys active"
    : activity === "praised"
    ? "compound"
    : activity === "sleeping"
    ? "quiet desk"
    : "market watch";
  return [
    boxTop(width, "STATUS"),
    boxContent(width, status),
    boxContent(width, motto),
    boxContent(width, `pipeline ${Math.round(stats.deals)}%`),
    boxBottom(width),
  ];
}

function fileCabinetLines(frame: number): string[] {
  const tab = frame % 4 < 2 ? "╞" : "├";
  return [
    "╭─ FILE ─╮",
    "│ ▤▤▤▤   │",
    `${tab}────────┤`,
    "│ ▤▤▤▤   │",
    "╰────────╯",
  ];
}

function wallRailLine(width: number, activity: PetActivity, frame: number): string {
  const status = activity === "working"
    ? frame % 2 === 0 ? "keys live" : "term live"
    : activity === "sleeping"
    ? "night desk"
    : activity === "praised"
    ? "memo cleared"
    : "calendar clear";
  return centerText("─".repeat(width), ` ${status} · office quiet · covenant wall `);
}

function deskJoinLine(width: number, leftCorner: string, midA: string, midB: string, rightCorner: string): string {
  const inner = Math.max(1, width - 2);
  const usable = Math.max(1, inner - 2);
  const left = Math.max(4, Math.floor(usable * 0.24));
  const mid = Math.max(8, Math.floor(usable * 0.42));
  const right = Math.max(1, usable - left - mid);
  return `${leftCorner}${"═".repeat(left)}${midA}${"═".repeat(mid)}${midB}${"═".repeat(right)}${rightCorner}`;
}

function deskContent(width: number, text = ""): string {
  return `║${padDisplayText(text, Math.max(1, width - 2))}║`;
}

function deskBaseLines(width: number, stats: PetStats, activity: PetActivity): string[] {
  const inner = Math.max(1, width - 2);
  const covenants = stats.happiness < 30 || stats.energy < 25 ? "WARN" : "OK";
  const close = activity === "praised" ? "COMPOUND" : activity === "working" ? "EXEC" : "WATCH";
  const pipe = Math.round(stats.deals);
  const fascia = width < 64
    ? ` [IN] │ DREXLER DESK │ PIPE ${pipe}% │ [OUT] `
    : width < 84
    ? ` [IN] │ DREXLER DEAL DESK │ PIPE ${pipe}% │ COV ${covenants} │ [OUT] `
    : ` [IN] │ DREXLER DEAL DESK │ PIPE ${pipe}% │ COV ${covenants} │ ${close} │ [OUT] `;
  return [
    `╔${"═".repeat(inner)}╗`,
    deskContent(width),
    deskContent(width),
    deskContent(width),
    deskContent(width),
    deskJoinLine(width, "╠", "╦", "╦", "╣"),
    deskContent(width, fascia),
    deskJoinLine(width, "╚", "╩", "╩", "╝"),
  ];
}

function floorShadowLines(width: number): string[] {
  const label = "deal-room carpet shadow";
  const shadow = `░░░░░░  ${label}  ░░░░░░`;
  return [
    centerText(blankRow(width), shadow),
    centerText(blankRow(width), "▁▁▁▁        ▁▁▁▁        ▁▁▁▁"),
  ];
}

function coffeeFrames(stats: PetStats): readonly (readonly string[])[] {
  const cup = `${cupForEnergy(stats.energy).slice(0, 1)}[__]`;
  if (stats.energy <= 20) {
    return [[
      "       ",
      "       ",
      `  ${cup}`,
    ]];
  }
  return [
    [
      "  (  ) ",
      " (    )",
      `  ${cup}`,
    ],
    [
      " (    )",
      "  (  ) ",
      `  ${cup}`,
    ],
    [
      "  )  ( ",
      " (    )",
      `  ${cup}`,
    ],
  ];
}

function memoFrames(activity: PetActivity): readonly (readonly string[])[] {
  const idle = [
    "╭────────╮",
    "│ memo ╲ │",
    "│ ────   │",
    "╰────────╯",
  ];
  const working = [
    "╭────────╮",
    "│ memo ╱ │",
    "│ ───    │",
    "╰────────╯",
  ];
  const success = [
    "╭────────╮",
    "│ done ✓ │",
    "│ ───    │",
    "╰────────╯",
  ];

  if (activity === "praised") return [success];
  if (activity === "working") return [idle, working];
  return [idle];
}

function keyboardFrames(activity: PetActivity): readonly (readonly string[])[] {
  const idle = [
    "┌────────────┐",
    "│ ▄ ▄ ▄ ▄ ▄ │",
    "└────────────┘",
  ];
  const active = [
    "┌────────────┐",
    "│ ▄ ▀ ▄ ▀ ▄ │",
    "└────────────┘",
  ];
  return activity === "working" ? [idle, active] : [idle];
}

function activityAccentLines(activity: PetActivity, frame: number): readonly string[] {
  switch (activity) {
    case "working":
      return [frame % 2 === 0 ? "$ >" : "$ _"];
    case "praised":
      return ["COMPOUND"];
    case "sleeping":
      return ["z z Z"];
    case "playing":
      return ["* rally *"];
    case "eating":
      return ["deal snack"];
    case "vibing":
      return ["~ flow ~"];
    default:
      return [""];
  }
}

function buildOfficeScene(
  activity: PetActivity,
  frame: number,
  stats: PetStats,
  width: number,
): Scene {
  const layout = sceneLayout(width);
  const sprites: Sprite[] = [];
  const mascotX = Math.max(0, Math.floor((width - MASCOT_WIDTH) / 2));
  const mascotBob = activity !== "sleeping" && frame > 0 && frame % 8 === 4 ? -1 : 0;
  const mascotY = R_MASCOT_START + mascotBob;
  const deskX = 1;
  const deskWidth = Math.max(30, width - 2);
  const coffeeFrameSet = coffeeFrames(stats);
  const memoFrameSet = memoFrames(activity);
  const keyboardFrameSet = keyboardFrames(activity);

  sprites.push(makeSprite("background:title", 0, 0, R_TITLE, [titleLine(width, stats)], "background"));
  const clock = analogClockLines(frame);
  sprites.push(makeAnimatedSprite({
    id: "wall:clock",
    zIndex: 12,
    x: Math.max(0, Math.floor((width - displayWidth(clock[0] ?? "")) / 2)),
    y: R_CLOCK_TOP,
    frames: [clock, analogClockLines(frame + 2)],
    frameDuration: 2,
    styleToken: "secondaryLine",
  }));

  if (layout === "compact") {
    sprites.push(
      makeSprite(
        "market:compact",
        20,
        1,
        R_WIN_TOP,
        marketBoardLines(width - 2, activity, frame, stats),
        "chartGrid",
      ),
    );
  } else {
    const windowWidth = layout === "wide" ? 28 : width < 76 ? 18 : 24;
    const marketX = windowWidth + 4;
    sprites.push(
      makeSprite("city:window", 10, 1, R_WIN_TOP, cityWindowLines(windowWidth, frame), "secondaryLine"),
      makeSprite(
        "market:board",
        20,
        marketX,
        R_WIN_TOP,
        marketBoardLines(width - marketX - 1, activity, frame, stats),
        "chartGrid",
      ),
    );
  }

  sprites.push(makeSprite(
    "wall:rail",
    8,
    0,
    R_WALL_RAIL,
    [wallRailLine(width, activity, frame)],
    "secondaryLine",
  ));

  if (layout !== "compact") {
    sprites.push(makeAnimatedSprite({
      id: "lamp:side",
      zIndex: 30,
      x: 2,
      y: R_MASCOT_START,
      frames: [lampLines(activity, frame), lampLines(activity, frame + 3)],
      frameDuration: 2,
      styleToken: "lampGlow",
    }));
  }

  if (layout === "wide" && width >= 118) {
    sprites.push(makeSprite(
      "status:card",
      30,
      Math.max(1, width - 21),
      R_MASCOT_START - 1,
      statusCardLines(20, activity, frame, stats),
      "statusAccent",
    ));
  }

  if (layout === "wide" && width >= 132) {
    sprites.push(makeAnimatedSprite({
      id: "storage:file-cabinet",
      zIndex: 35,
      x: Math.max(1, width - 34),
      y: R_DESK_LINE - 6,
      frames: [fileCabinetLines(frame), fileCabinetLines(frame + 2)],
      frameDuration: 3,
      styleToken: "secondaryLine",
    }));
  }

  sprites.push(makeAnimatedSprite({
    id: "drexler:mascot",
    zIndex: 50,
    x: mascotX,
    y: mascotY,
    frames: [renderMascotLines(mascotStateForActivity(activity, frame))],
    frameDuration: 3,
    styleToken: "drexlerOutline",
  }));

  sprites.push(makeSprite(
    "desk:foreground",
    80,
    deskX,
    R_DESK_LINE,
    deskBaseLines(deskWidth, stats, activity),
    "primaryLine",
    false,
  ));

  sprites.push(makeSprite(
    "drexler:money-panel",
    95,
    mascotX + 6,
    Math.min(mascotY + 5, R_DESK_LINE - 1),
    [activity === "sleeping" ? "║ ░░ ║" : "║ $$ ║"],
    activity === "praised" ? "statusAccent" : "drexlerOutline",
    false,
  ));

  sprites.push(makeAnimatedSprite({
    id: "desk:coffee",
    zIndex: 90,
    x: deskX + 3,
    y: R_DESK_PROPS,
    frames: coffeeFrameSet,
    frameDuration: activity === "sleeping" ? 5 : 2,
    styleToken: "statusAccent",
    parentAnchor: "desk:foreground",
    transparentSpaces: true,
  }));

  sprites.push(makeAnimatedSprite({
    id: "desk:memo",
    zIndex: 90,
    x: Math.max(deskX + 12, Math.floor(width / 2) - 7),
    y: R_DESK_PROPS,
    frames: memoFrameSet,
    frameDuration: 2,
    styleToken: "primaryLine",
    parentAnchor: "desk:foreground",
    transparentSpaces: false,
  }));

  const keyboardWidth = displayWidth(keyboardFrameSet[0]?.[0] ?? "");
  sprites.push(makeAnimatedSprite({
    id: "desk:keyboard",
    zIndex: 90,
    x: Math.min(
      deskX + deskWidth - 2 - keyboardWidth,
      Math.floor(width / 2) + 13,
    ),
    y: R_DESK_PROPS,
    frames: keyboardFrameSet,
    frameDuration: activity === "working" ? 1 : 3,
    styleToken: "primaryLine",
    parentAnchor: "desk:foreground",
    transparentSpaces: false,
  }));

  const accent = activityAccentLines(activity, frame);
  if (accent[0]) {
    sprites.push(makeSprite(
      "effect:status",
      100,
      Math.min(width - displayWidth(accent[0] ?? ""), mascotX + MASCOT_WIDTH + 2),
      R_MASCOT_START + 3,
      accent,
      "statusAccent",
    ));
  }

  sprites.push(makeSprite(
    "floor:shadow",
    2,
    0,
    R_FLOOR_SHADOW,
    floorShadowLines(width),
    "background",
  ));

  return { width, height: SCENE_ROWS, sprites };
}

function buildStyledScene(
  activity: PetActivity,
  frame: number,
  stats: PetStats,
  width: number,
): StyledSegment[][] {
  const sceneWidth = Math.max(PET_SCENE_WIDTH, Math.floor(width));
  const timeline: AnimationTimeline = {
    frame,
    sceneState: sceneStateForActivity(activity),
  };
  return composeStyledScene(buildOfficeScene(activity, frame, stats, sceneWidth), timeline);
}

function colorForStyleToken(
  token: StyleToken,
  activity: PetActivity,
  frame: number,
  t: Theme,
): string {
  switch (token) {
    case "background":
      return t.dim;
    case "secondaryLine":
    case "chartGrid":
      return t.primaryDim;
    case "primaryLine":
      return t.text;
    case "drexlerOutline":
      if (activity === "sleeping") return t.dim;
      if (activity === "praised") return t.primaryLight;
      if (activity === "eating") return t.warning;
      if (activity === "playing") return frame % 6 >= 3 ? t.primaryLight : t.primary;
      return t.primary;
    case "positiveCandle":
      return t.primaryLight;
    case "negativeCandle":
      return t.error;
    case "lampGlow":
      return activity === "sleeping" ? t.dim : t.warning;
    case "statusAccent":
      if (activity === "working" && frame % 32 >= 26) return t.warning;
      if (activity === "praised") return t.primaryLight;
      if (activity === "sleeping") return t.dim;
      return t.primaryLight;
    default:
      return t.primary;
  }
}

// ─── status messages ──────────────────────────────────────────────────────────
type MsgLevel = "critical" | "low" | "ok" | "good" | "great";
function statLevel(v: number): MsgLevel {
  if (v < 20) return "critical";
  if (v < 40) return "low";
  if (v < 65) return "ok";
  if (v < 85) return "good";
  return "great";
}

const MESSAGES: Record<string, readonly string[]> = {
  "hunger.critical": ["Feed him. Now.","Pipeline empty. Stomach emptier.","Caloric intake: zero.","Deal intake required. Urgent.","No lunch. Board concerned."],
  "hunger.low":      ["Could use a deal snack.","Peckish. Dangerously so.","Running on fumes and spite.","Lunch was conceptual.","Hunger creeping. Bad sign."],
  "hunger.ok":       ["Fed. Functional.","Satiated. Marginally.","Nourishment confirmed.","Caloric metrics acceptable.","Pipeline: sufficient."],
  "hunger.good":     ["Well fed. Projecting strength.","Deal appetite satisfied.","Lunch closed. Board nods.","Caloric position: strong.","Nutritionally sound."],
  "hunger.great":    ["Fully loaded. Ready to close.","Peak caloric window open.","Briefcase well-stocked.","Drexler has eaten. Fear him.","Maximum deal absorption."],

  "happiness.critical": ["Morale: sub-basement.","Joy metrics: catastrophic.","Drexler deeply dissatisfied.","Considering self-restructure.","Send help. Immediately."],
  "happiness.low":      ["Confidence is flagging.","Sentiment negative. Act now.","Drexler is not thriving.","Market ungrateful, apparently.","Spirits declining. Alarming."],
  "happiness.ok":       ["Maintaining composure.","Cautiously optimistic.","Neutral outlook. For now.","Equilibrium: tenuous.","Tolerable. Barely."],
  "happiness.good":     ["Pipeline robust. Spirits up.","Drexler is in the zone.","Good day in the deal room.","Shareholders pleased. Briefly.","Morale: acceptable."],
  "happiness.great":    ["Unstoppable. Frankly.","Peak performance window.","Manic energy. Deploy wisely.","Drexler ascendant. Watch out.","Maximum euphoria. Imminent."],

  "energy.critical": ["Running on fumes. Critical.","System depleted. Recharge.","Drexler barely upright.","Energy: dangerous lows.","Rest now. Non-negotiable."],
  "energy.low":      ["Coffee required. Urgently.","Flagging slightly. Or a lot.","Energy deficit detected.","Strategic nap advised.","Reserves low. Efficiency shaky."],
  "energy.ok":       ["Operational. Barely.","Chugging along.","Energy acceptable. Recheck.","Functional. Not inspired.","Adequate. For now."],
  "energy.good":     ["Energized. Alert. Ready.","Ready to close deals.","Drexler is firing well.","Full capacity. Mostly.","Energy surplus confirmed."],
  "energy.great":    ["Fully charged. Dangerous.","Drexler is electrified.","Energy max. Scope unlimited.","Running at 110%. Somehow.","Kinetic. Caffeinated."],

  "deals.critical": ["Pipeline: bone dry.","No deals. Board is watching.","Zero live mandates. Shameful.","Origination needed. Now.","Empty pipe. Reputation at risk."],
  "deals.low":      ["Pipeline thin. Worrying.","Deal flow: trickling.","Source aggressively.","Activity light. Drexler restless.","Book thin. Posture defensive."],
  "deals.ok":       ["Pipeline: moderate.","Deal flow steady. Could improve.","Working the book.","Several irons in the fire.","Deal cadence acceptable."],
  "deals.good":     ["Pipeline full. Drexler pleased.","Multiple term sheets live.","Deal machine: operational.","The book is healthy.","Deal flow strong. Board nods."],
  "deals.great":    ["Crushing it, frankly.","Overflowing pipeline. Good problem.","Drexler is the deal machine.","Maximum origination achieved.","Board in awe. Secretly."],
};

function getStatusMsg(stats: PetStats, frame: number): string {
  const entries: [string, number][] = [
    ["hunger", stats.hunger], ["happiness", stats.happiness],
    ["energy", stats.energy], ["deals", stats.deals],
  ];
  entries.sort((a, b) => a[1] - b[1]);
  const [worstStat, worstVal] = entries[0] ?? ["happiness", 50];
  const key = `${worstStat}.${statLevel(worstVal)}`;
  const msgs = MESSAGES[key] ?? ["Operational."];
  return msgs[Math.floor(frame / 10) % msgs.length] ?? "Operational.";
}

export function getPetStatusMessage(stats: PetStats, frame = 0): string {
  return getStatusMsg(stats, frame);
}

// ─── component ────────────────────────────────────────────────────────────────
interface PetSceneProps {
  stats: PetStats;
  activity: PetActivity;
  env?: Environment;
  isPaused?: boolean;
  width?: number;
}

interface CompactPetPanelProps extends PetSceneProps {
  width: number;
}

function usePetFrame({
  activity,
  isPaused,
  dead,
}: {
  activity: PetActivity;
  isPaused: boolean;
  dead: boolean;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
  }, [activity]);

  useEffect(() => {
    // Skip frame ticks when paused or when the pet has died — DeathScreen
    // takes over the UI, no point burning a setInterval that mutates state
    // nothing will read.
    if (isPaused || dead) return;
    const id = setInterval(() => {
      setFrame((f) => f + 1);
    }, 800);
    return () => clearInterval(id);
  }, [dead, isPaused]);

  return frame;
}

export function PetScene({
  stats,
  activity,
  isPaused = false,
  width = PET_SCENE_WIDTH,
}: PetSceneProps) {
  const t = useTheme();
  const sceneWidth = Math.max(PET_SCENE_WIDTH, Math.floor(width));
  const frame = usePetFrame({
    activity,
    isPaused,
    dead: stats.dead === true,
  });
  const scene = useMemo(
    () => buildStyledScene(activity, frame, stats, sceneWidth),
    [activity, frame, sceneWidth, stats],
  );

  return (
    <Box flexDirection="column" width={sceneWidth} flexShrink={0}>
      {scene.map((row, i) => (
        <Text key={i}>
          {row.map((segment, segmentIdx) => (
            <Text
              key={segmentIdx}
              color={colorForStyleToken(segment.styleToken, activity, frame, t)}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

const STAT_LEVEL_LABEL: Record<MsgLevel, string> = {
  critical: "critical",
  low: "low",
  ok: "ok",
  good: "good",
  great: "peak",
};

interface CompactStatProfile {
  hunger: MsgLevel;
  happiness: MsgLevel;
  energy: MsgLevel;
  deals: MsgLevel;
}

function compactStatProfile(stats: PetStats): CompactStatProfile {
  return {
    hunger: statLevel(stats.hunger),
    happiness: statLevel(stats.happiness),
    energy: statLevel(stats.energy),
    deals: statLevel(stats.deals),
  };
}

interface WorstStat {
  key: "hunger" | "happiness" | "energy" | "deals";
  value: number;
}

function pickWorstStat(stats: PetStats): WorstStat {
  const entries: WorstStat[] = [
    { key: "hunger", value: stats.hunger },
    { key: "happiness", value: stats.happiness },
    { key: "energy", value: stats.energy },
    { key: "deals", value: stats.deals },
  ];
  return entries.reduce((best, cur) =>
    cur.value < best.value ? cur : best,
  );
}

function CompactPetPanelView({
  stats,
  activity,
  isPaused = false,
  width,
}: CompactPetPanelProps) {
  const t = useTheme();
  const safeWidth = Math.max(1, width);

  // Rotate the memo every 10s so the compact panel doesn't feel static.
  // Paused panels lock to a single message (no decay-tick to refresh anyway).
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 10_000));
  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => {
      setTick(Math.floor(Date.now() / 10_000));
    }, 10_000);
    return () => clearInterval(id);
  }, [isPaused]);

  const mood = getPetMood(stats);
  const profile = compactStatProfile(stats);
  const activityCopy = activity === "idle" ? "office" : `office / ${activity}`;
  const title = "Drexler Pet Desk";
  const statLine = [
    `happy ${STAT_LEVEL_LABEL[profile.happiness]}`,
    `hungr ${STAT_LEVEL_LABEL[profile.hunger]}`,
    `enrgy ${STAT_LEVEL_LABEL[profile.energy]}`,
    `deals ${STAT_LEVEL_LABEL[profile.deals]}`,
  ].join("  ·  ");
  const statusLine = `memo ${getStatusMsg(stats, tick)}`;

  if (safeWidth < COMPACT_PET_PANEL_MIN_WIDTH) {
    // Worst stat drives the ticker so an idle eye still catches a failing
    // metric instead of a fixed happy/energy readout.
    const worst = pickWorstStat(stats);
    const worstLevel = statLevel(worst.value);
    const accent = worstLevel === "critical" || worstLevel === "low"
      ? t.warning
      : t.primary;
    return (
      <Box width={safeWidth} flexShrink={1}>
        <Text color={accent}>
          {fitDisplayText(
            `pet ${mood} · ${worst.key} ${pct(worst.value)} (${worstLevel})`,
            safeWidth,
          )}
        </Text>
      </Box>
    );
  }

  const innerWidth = Math.max(1, safeWidth - PANEL_BORDER_COLUMNS - PANEL_PADDING_COLUMNS);
  const header = `${title} [${activityCopy}]`;

  return (
    <Box
      flexDirection="column"
      width={safeWidth}
      flexShrink={1}
      borderStyle="round"
      borderColor={t.primaryDim}
      paddingX={1}
    >
      <Box>
        <Text color={t.primary} bold>{fitDisplayText(header, innerWidth)}</Text>
      </Box>
      <Box>
        <Text color={t.text}>{fitDisplayText(statLine, innerWidth)}</Text>
      </Box>
      <Box>
        <Text color={t.dim}>{fitDisplayText(`${mood} · ${statusLine}`, innerWidth)}</Text>
      </Box>
    </Box>
  );
}

export const CompactPetPanel = memo(CompactPetPanelView);
