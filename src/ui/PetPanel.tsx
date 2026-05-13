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
export const PET_SCENE_ROWS = 33;
const SCENE_ROWS = PET_SCENE_ROWS;
// Row map for the animated trading-office scene.
// 0      title bar  (DREXLER OFFICE · stat readout)
// 1-7    wall-mounted analog clock
// 8-15   city window and DREXLER MARKETS wall board
// 16     rear wall trim
// 17-23  Drexler mascot midground
// 23-30  centered foreground desk and props. This intentionally overlaps the
//        lower mascot rows so Drexler reads as seated behind the desk.
const R_TITLE = 0;
const R_CLOCK_TOP = 1;
const R_BOARD_TOP = 8;
const R_WIN_TOP = R_BOARD_TOP;
const R_WALL_RAIL = 16;
const R_MASCOT_START = 17;
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
  | "deskLine"
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

interface OfficeMetrics {
  layout: SceneLayout;
  stageWidth: number;
  stageX: number;
  centerX: number;
  deskWidth: number;
  deskX: number;
  boardWidth: number;
  boardX: number;
  windowWidth: number;
  windowX: number;
}

function sceneLayout(width: number): SceneLayout {
  if (width >= 104) return "wide";
  if (width >= 68) return "standard";
  return "compact";
}

function officeMetrics(width: number): OfficeMetrics {
  const layout = sceneLayout(width);
  const sidePad = layout === "compact" ? 1 : 2;
  const maxStageWidth = layout === "wide" ? 124 : layout === "standard" ? 96 : width - 2;
  const stageWidth = Math.max(
    1,
    Math.min(maxStageWidth, Math.max(1, width - sidePad * 2)),
  );
  const stageX = Math.max(0, Math.floor((width - stageWidth) / 2));
  const centerX = stageX + Math.floor(stageWidth / 2);
  const deskWidth = Math.max(
    30,
    layout === "compact"
      ? stageWidth
      : layout === "standard"
      ? Math.min(70, stageWidth - 2)
      : Math.min(84, stageWidth - 10),
  );
  const deskX = Math.max(stageX, centerX - Math.floor(deskWidth / 2));
  const windowWidth = layout === "wide" ? 24 : layout === "standard" ? 18 : 0;
  const boardGap = layout === "wide" ? 4 : 3;
  const boardWidth = layout === "compact"
    ? stageWidth
    : Math.max(44, stageWidth - windowWidth - boardGap);
  const windowX = stageX;
  const boardX = layout === "compact" ? stageX : windowX + windowWidth + boardGap;

  return {
    layout,
    stageWidth,
    stageX,
    centerX,
    deskWidth,
    deskX,
    boardWidth,
    boardX,
    windowWidth,
    windowX,
  };
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
  const { width, height } = scene;
  const rows: StyledCell[][] = new Array(height);
  for (let r = 0; r < height; r++) {
    const row: StyledCell[] = new Array(width);
    for (let c = 0; c < width; c++) {
      row[c] = { glyph: " ", styleToken: "background" };
    }
    rows[r] = row;
  }

  // sprites are pre-sorted by buildOfficeScene (zIndex, then id); do not re-sort here.
  const sprites = scene.sprites;
  for (let s = 0; s < sprites.length; s++) {
    const sprite = sprites[s]!;
    if (sprite.visibility && !sprite.visibility(timeline)) continue;
    const lines = frameForSprite(sprite, timeline);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const rowIdx = sprite.y + lineIdx;
      if (rowIdx < 0 || rowIdx >= height) continue;
      overlayCellLine(
        rows[rowIdx] ?? blankCellRow(width),
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

function plainBoxTop(width: number): string {
  return `╭${"─".repeat(Math.max(0, width - 2))}╮`;
}

function boxBottom(width: number): string {
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function boxContent(width: number, text: string): string {
  return `│${padDisplayText(text, Math.max(1, width - 2))}│`;
}

function boxRowFromInner(width: number, innerText: string): string {
  return `│${padDisplayText(innerText, Math.max(1, width - 2))}│`;
}

function placeRight(base: string, text: string, padding = 1): string {
  return place(
    base,
    fitDisplayText(text, Math.max(1, base.length)),
    Math.max(0, base.length - displayWidth(text) - padding),
  );
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

function clockTimeFromFrame(frame: number): { hour: number; minute: number } {
  const startHour = 9; // boardroom opens at 9 AM corporate time.
  const totalMinutes = startHour * 60 + Math.floor(frame / 5);
  return {
    hour: Math.floor(totalMinutes / 60) % 24,
    minute: totalMinutes % 60,
  };
}

function clockFromFrame(frame: number): string {
  // Slow ambient clock — advances roughly one minute every 5 frames.
  const { hour, minute } = clockTimeFromFrame(frame);
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const CLOCK_WIDTH = 21;
const CLOCK_ROWS = 7;
const CLOCK_CENTER_X = 10;
const CLOCK_CENTER_Y = 3;

function normalizeClockNumber(value: number, modulo: number): number {
  const whole = Math.trunc(Number.isFinite(value) ? value : 0);
  return ((whole % modulo) + modulo) % modulo;
}

function drawHand(cells: string[][], hourPos: number, isLong: boolean): void {
  const h = Math.floor(hourPos) % 12;
  const glyphs: Record<number, string> = {
    0: "│", 1: "╱", 2: "╱", 3: "─", 4: "╲", 5: "╲",
    6: "│", 7: "╱", 8: "╱", 9: "─", 10: "╲", 11: "╲",
  };
  const glyph = glyphs[h] || "·";

  // Handcrafted offsets for a 21x7 clock. These are stable and aspect-ratio aware.
  const offsets: Record<number, [number, number][]> = {
    0:  [[0, -1]],
    1:  [[2, -1]],
    2:  [[4, -1]],
    3:  [[1, 0], [2, 0], [3, 0], [4, 0]],
    4:  [[4, 1]],
    5:  [[2, 1]],
    6:  [[0, 1]],
    7:  [[-2, 1]],
    8:  [[-4, 1]],
    9:  [[-1, 0], [-2, 0], [-3, 0], [-4, 0]],
    10: [[-4, -1]],
    11: [[-2, -1]],
  };

  const points = offsets[h] || [];
  const limit = isLong ? points.length : Math.max(1, Math.floor(points.length / 2));

  for (let i = 0; i < limit; i++) {
    const [dx, dy] = points[i]!;
    const x = CLOCK_CENTER_X + dx;
    const y = CLOCK_CENTER_Y + dy;
    if (x > 0 && x < CLOCK_WIDTH - 1 && y > 0 && y < CLOCK_ROWS - 1) {
      cells[y]![x] = glyph;
    }
  }
}

function stampClockBorder(cells: string[][]): void {
  for (let x = 0; x < CLOCK_WIDTH; x++) {
    cells[0]![x] = x === 0 ? "╭" : x === CLOCK_WIDTH - 1 ? "╮" : "─";
    cells[CLOCK_ROWS - 1]![x] = x === 0 ? "╰" : x === CLOCK_WIDTH - 1 ? "╯" : "─";
  }
  for (let y = 1; y < CLOCK_ROWS - 1; y++) {
    cells[y]![0] = "│";
    cells[y]![CLOCK_WIDTH - 1] = "│";
  }
}

function stampClockText(cells: string[][], text: string, x: number, y: number): void {
  if (y < 0 || y >= CLOCK_ROWS) return;
  for (let i = 0; i < text.length; i++) {
    const col = x + i;
    if (col < 0 || col >= CLOCK_WIDTH) continue;
    cells[y]![col] = text[i]!;
  }
}

function buildAsciiClockLines(hour: number, minute: number): string[] {
  const safeHour = normalizeClockNumber(hour, 24);
  const safeMinute = normalizeClockNumber(minute, 60);
  const cells = Array.from({ length: CLOCK_ROWS }, () =>
    Array.from({ length: CLOCK_WIDTH }, () => " "),
  );

  const hourPos = (safeHour % 12);
  const minutePos = Math.floor(safeMinute / 5);

  drawHand(cells, minutePos, true);
  drawHand(cells, hourPos, false);

  stampClockText(cells, "12", 9, 1);
  stampClockText(cells, "9", 5, 3);
  stampClockText(cells, "·", CLOCK_CENTER_X, 3);
  stampClockText(cells, "3", 15, 3);
  stampClockText(cells, "6", CLOCK_CENTER_X, 5);
  stampClockBorder(cells);

  return cells.map((row) => row.join("").padEnd(CLOCK_WIDTH, " ").slice(0, CLOCK_WIDTH));
}

export function buildAsciiClock(hour: number, minute: number): string {
  return buildAsciiClockLines(hour, minute).join("\n");
}

export function analogClockLines(frame: number): string[] {
  const { hour, minute } = clockTimeFromFrame(frame);
  return buildAsciiClockLines(hour, minute);
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
      plainBoxTop(width),
      boxContent(width, `╭──╮ ${sun}`),
      boxContent(width, `│╥╥│ ${skyline}`),
      boxContent(width, "│▒▒│ ┄┄"),
      boxContent(width, "╰──╯ ▁▁"),
      boxBottom(width),
    ];
  }
  return [
    plainBoxTop(width),
    boxContent(width, `╭──╮ ╭──╮  ${sun} ${cloud}`),
    boxContent(width, `│╥╥│ │╤╤│  ${skyline}`),
    boxContent(width, "│▒▒│ │░░│  ┄┄┄"),
    boxContent(width, "╰──╯ ╰──╯  ▁▁▁"),
    boxBottom(width),
  ];
}

function marketBoardRow(width: number, left: string, chart: string, axis: string): string {
  const inner = Math.max(1, width - 2);
  let row = blankRow(inner);
  row = placeRight(row, axis, 1);
  const chartX = Math.max(
    18,
    Math.min(inner - displayWidth(axis) - displayWidth(chart) - 3, Math.floor(inner * 0.46)),
  );
  row = place(row, fitDisplayText(left, Math.max(1, chartX - 2)), 1);
  row = place(row, chart, Math.max(1, chartX));
  return boxRowFromInner(width, row);
}

function marketBoardSplitRow(width: number, left: string, right: string): string {
  const inner = Math.max(1, width - 2);
  let row = blankRow(inner);
  const fittedRight = fitDisplayText(right, Math.max(1, inner - 2));
  const rightX = Math.max(0, inner - displayWidth(fittedRight) - 1);
  row = place(row, fitDisplayText(left, Math.max(1, rightX - 2)), 1);
  row = place(row, fittedRight, rightX);
  return boxRowFromInner(width, row);
}

function marketBoardCell(text: string, width: number, align: "left" | "center" | "right"): string {
  const safeWidth = Math.max(1, width);
  const fitted = fitDisplayText(text, safeWidth);
  const padding = Math.max(0, safeWidth - displayWidth(fitted));
  if (align === "right") return `${" ".repeat(padding)}${fitted}`;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    return `${" ".repeat(left)}${fitted}${" ".repeat(padding - left)}`;
  }
  return `${fitted}${" ".repeat(padding)}`;
}

function marketBoardPanelRow(width: number, left: string, center: string, right: string): string {
  const inner = Math.max(1, width - 2);
  const contentWidth = Math.max(1, inner - 2);
  const separator = " │ ";
  const leftWidth = Math.min(32, Math.max(18, Math.floor(contentWidth * 0.3)));
  const rightWidth = Math.min(12, Math.max(9, Math.floor(contentWidth * 0.14)));
  const centerWidth = Math.max(1, contentWidth - leftWidth - rightWidth - separator.length * 2);
  const content = [
    marketBoardCell(left, leftWidth, "left"),
    marketBoardCell(center, centerWidth, "center"),
    marketBoardCell(right, rightWidth, "right"),
  ].join(separator);
  const row = ` ${content} `;
  return boxRowFromInner(width, row);
}

function marketBoardLines(
  width: number,
  activity: PetActivity,
  frame: number,
  stats: PetStats,
): string[] {
  const status = activityStatusToken(activity, frame);
  const candleA = frame % 4 < 2 ? "▐█▌" : "▐░▌";
  const candleB = activity === "praised" ? "▐█▌" : frame % 5 < 3 ? "▐░▌" : "▐█▌";
  const candleC = activity === "working" ? "▐█▌" : "▐░▌";
  const finalCandle = activity === "praised" ? "▐█▌" : frame % 6 < 3 ? "▐█▌" : "▐░▌";
  const fee = Math.max(40, Math.min(99, Math.round((stats.happiness + stats.deals) / 2)));
  const pipe = Math.round(stats.deals);
  const chartLabel = boardTapeLabel(activity, frame);
  const narrow = width < 58;
  const tapeMarker = frame % 2 === 0 ? ">" : "_";
  const chartA = `┄┄┄┄ ${candleA} │`;
  const chartB = `│ ${candleB} │ ${candleC}`;
  const chartC = `${candleB} │ ${finalCandle} │`;

  if (narrow) {
    return [
      boxTop(width, "DREXLER MARKETS"),
      marketBoardSplitRow(width, `DEMO ${clockFromFrame(frame)} ${status}`, `FEE ${fee}%`),
      boxContent(width, ` TAPE${tapeMarker} BTC ▲1.25  ETH ▲0.82`),
      boxContent(width, " BID .8419   ASK .8423   VOL 24K"),
      marketBoardRow(width, "BTC 67842 ▲1.25", chartA, "69000"),
      marketBoardRow(width, "ETH  3241 ▲0.82", chartB, "68000"),
      boxContent(width, ` OPEN 09:00  ${chartLabel}  PIPE ${pipe}%`),
      boxBottom(width),
    ];
  }

  const headerLeft = "DREX 0.8421 ▲3.17";
  const headerCenter = `DEMO ${clockFromFrame(frame)} ${status}`;
  const footerCenter = width < 90
    ? `OPEN 09:00  ${chartLabel}`
    : `OPEN 09:00  13:00  ${chartLabel}  CLOSE 16:00`;
  return [
    boxTop(width, "DREXLER MARKETS"),
    marketBoardPanelRow(width, headerLeft, headerCenter, `FEE ${fee}%`),
    marketBoardPanelRow(width, `TAPE${tapeMarker} BTC ▲1.25`, "CANDLE", "VOL 24K"),
    marketBoardPanelRow(width, "BTC 67842  ▲1.25", chartA, "69000"),
    marketBoardPanelRow(width, "ETH  3241  ▲0.82", chartB, "68000"),
    marketBoardPanelRow(width, "SOL   157  ▲2.11", chartC, "67000"),
    marketBoardPanelRow(width, "BID .8419  ASK .8423", footerCenter, `PIPE ${pipe}%`),
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
  const rays = activity === "sleeping" ? "    │    " : frame % 6 < 3 ? "   ╲│╱   " : "   ╱│╲   ";
  return [
    rays,
    "  ╭───╮  ",
    " ╭╯   ╰╮ ",
    " ╰──┬──╯ ",
    "    │    ",
    "   ═╧═   ",
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
    "╭────────╮",
    "│ ▤▤▤▤   │",
    `${tab}────────┤`,
    "│ ▤▤▤▤   │",
    "╰────────╯",
  ];
}

function wallRailLine(width: number, activity: PetActivity, frame: number): string {
  const trim = activity === "working" && frame % 2 === 0 ? "─╴╴─" : "────";
  return centerText("─".repeat(width), trim);
}

function deskJoinLine(width: number, leftCorner: string, midA: string, midB: string, rightCorner: string): string {
  const inner = Math.max(1, width - 2);
  const usable = Math.max(1, inner - 2);
  const left = Math.max(4, Math.floor(usable * 0.24));
  const mid = Math.max(8, Math.floor(usable * 0.42));
  const right = Math.max(1, usable - left - mid);
  return `${leftCorner}${"─".repeat(left)}${midA}${"─".repeat(mid)}${midB}${"─".repeat(right)}${rightCorner}`;
}

function deskContent(width: number, text = ""): string {
  return `│${padDisplayText(text, Math.max(1, width - 2))}│`;
}

function deskDrawerLine(width: number): string {
  const inner = Math.max(1, width - 2);
  const row = blankRow(inner);
  const drawer = "╭──────╮";
  const left = Math.max(1, Math.floor(inner * 0.18) - Math.floor(drawer.length / 2));
  const right = Math.max(1, Math.floor(inner * 0.82) - Math.floor(drawer.length / 2));
  return `│${place(place(row, drawer, left), drawer, right)}│`;
}

function deskFasciaLine(width: number, center: string, right: string): string {
  const inner = Math.max(1, width - 2);
  let row = blankRow(inner);
  const fittedCenter = fitDisplayText(center, Math.max(1, inner - displayWidth(right) - 8));
  const rightX = Math.max(0, inner - displayWidth(right) - 2);
  const centerX = Math.max(1, Math.floor((inner - displayWidth(fittedCenter)) / 2));
  if (rightX <= centerX + displayWidth(fittedCenter) + 2) {
    return `│${centerText(row, `${center} · ${right}`)}│`;
  }
  row = place(
    row,
    fittedCenter,
    centerX,
  );
  row = placeRight(row, right, 2);
  return `│${row}│`;
}

function deskBaseLines(width: number, stats: PetStats, activity: PetActivity): string[] {
  const inner = Math.max(1, width - 2);
  const covenants = stats.happiness < 30 || stats.energy < 25 ? "WARN" : "OK";
  const close = activity === "praised" ? "COMPOUND" : activity === "working" ? "EXEC" : "WATCH";
  const pipe = Math.round(stats.deals);
  const fascia = width < 64
    ? "DREXLER DESK"
    : width < 84
    ? "DREXLER DEAL DESK"
    : "DREXLER DEAL DESK";
  const readout = width < 64
    ? `PIPE ${pipe}%`
    : `PIPE ${pipe}%  COV ${covenants}  ${close}`;
  return [
    `╭${"─".repeat(inner)}╮`,
    deskContent(width),
    deskContent(width),
    deskContent(width),
    deskDrawerLine(width),
    deskJoinLine(width, "├", "┬", "┬", "┤"),
    deskFasciaLine(width, fascia, readout),
    deskJoinLine(width, "╰", "┴", "┴", "╯"),
  ];
}

function floorShadowLines(width: number): string[] {
  const shadow = "░░░░░░        ░░░░░░        ░░░░░░";
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
  const metrics = officeMetrics(width);
  const layout = metrics.layout;
  const sprites: Sprite[] = [];
  const mascotX = Math.max(0, metrics.centerX - Math.floor(MASCOT_WIDTH / 2));
  const mascotBob = activity !== "sleeping" && frame > 0 && frame % 8 === 4 ? -1 : 0;
  const mascotY = R_MASCOT_START + mascotBob;
  const deskX = metrics.deskX;
  const deskWidth = metrics.deskWidth;
  const coffeeFrameSet = coffeeFrames(stats);
  const memoFrameSet = memoFrames(activity);
  const keyboardFrameSet = keyboardFrames(activity);

  sprites.push(makeSprite("background:title", 0, 0, R_TITLE, [titleLine(width, stats)], "background"));
  const clock = analogClockLines(frame);
  sprites.push(makeSprite(
    "wall:clock",
    12,
    Math.max(0, Math.floor((width - displayWidth(clock[0] ?? "")) / 2)),
    R_CLOCK_TOP,
    clock,
    "secondaryLine",
  ));

  if (layout === "compact") {
    sprites.push(
      makeSprite(
        "market:compact",
        20,
        metrics.boardX,
        R_WIN_TOP,
        marketBoardLines(metrics.boardWidth, activity, frame, stats),
        "chartGrid",
      ),
    );
  } else {
    sprites.push(
      makeSprite(
        "city:window",
        10,
        metrics.windowX,
        R_WIN_TOP,
        cityWindowLines(metrics.windowWidth, frame),
        "secondaryLine",
      ),
      makeSprite(
        "market:board",
        20,
        metrics.boardX,
        R_WIN_TOP,
        marketBoardLines(metrics.boardWidth, activity, frame, stats),
        "chartGrid",
      ),
    );
  }

  sprites.push(makeSprite(
    "wall:rail",
    8,
    metrics.stageX,
    R_WALL_RAIL,
    [wallRailLine(metrics.stageWidth, activity, frame)],
    "secondaryLine",
  ));

  if (layout !== "compact") {
    sprites.push(makeAnimatedSprite({
      id: "lamp:side",
      zIndex: 30,
      x: metrics.stageX + 2,
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
      Math.max(metrics.stageX, metrics.stageX + metrics.stageWidth - 21),
      R_MASCOT_START + 1,
      statusCardLines(20, activity, frame, stats),
      "statusAccent",
    ));
  }

  if (layout === "wide" && width >= 132) {
    sprites.push(makeAnimatedSprite({
      id: "storage:file-cabinet",
      zIndex: 35,
      x: Math.max(metrics.stageX, metrics.stageX + metrics.stageWidth - 32),
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
    "deskLine",
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
    x: Math.max(deskX + 12, metrics.centerX - 7),
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
      metrics.centerX + 13,
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

  sprites.sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.id.localeCompare(b.id);
  });

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
    case "deskLine":
      return t.primaryDim;
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
