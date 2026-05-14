import type { PetActivity, PetStats } from "../../pet/petState.ts";
import { displayWidth, fitDisplayText, splitGraphemes } from "../graphemes.ts";

// ─── width / grapheme helpers ────────────────────────────────────────────────

export function place(base: string, text: string, x: number): string {
  if (x < 0 || x >= base.length) return base;
  const end = Math.min(base.length, x + text.length);
  const fit = text.slice(0, end - x);
  return base.slice(0, x) + fit + base.slice(end);
}

export function blankRow(width: number): string {
  return " ".repeat(width);
}

export function padDisplayText(input: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const fitted = fitDisplayText(input, safeWidth);
  return `${fitted}${" ".repeat(Math.max(0, safeWidth - displayWidth(fitted)))}`;
}

export function centerText(row: string, text: string): string {
  const safeText = fitDisplayText(text, row.length);
  const x = Math.max(0, Math.floor((row.length - displayWidth(safeText)) / 2));
  return place(row, safeText, x);
}

export function placeRight(base: string, text: string, padding = 1): string {
  return place(
    base,
    fitDisplayText(text, Math.max(1, base.length)),
    Math.max(0, base.length - displayWidth(text) - padding),
  );
}

export function labeledRule(width: number, label: string): string {
  const safeWidth = Math.max(2, width);
  const inner = safeWidth - 2;
  const fitted = fitDisplayText(` ${label} `, inner);
  const left = Math.max(0, Math.floor((inner - displayWidth(fitted)) / 2));
  const right = Math.max(0, inner - left - displayWidth(fitted));
  return `${"─".repeat(left)}${fitted}${"─".repeat(right)}`;
}

export function boxTop(width: number, label: string): string {
  return `╭${labeledRule(Math.max(2, width), label)}╮`;
}

export function plainBoxTop(width: number): string {
  return `╭${"─".repeat(Math.max(0, width - 2))}╮`;
}

export function boxBottom(width: number): string {
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

export function boxContent(width: number, text: string): string {
  return `│${padDisplayText(text, Math.max(1, width - 2))}│`;
}

export function boxRowFromInner(width: number, innerText: string): string {
  return `│${padDisplayText(innerText, Math.max(1, width - 2))}│`;
}

// ─── scene / sprite primitives ───────────────────────────────────────────────

export type SceneState = "boot" | "idle" | "working" | "success" | "error" | "sleep";

export type StyleToken =
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

export interface Frame {
  lines: readonly string[];
  duration: number;
}

export interface AnimationTimeline {
  frame: number;
  sceneState: SceneState;
}

export interface Sprite {
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

export interface Scene {
  width: number;
  height: number;
  sprites: readonly Sprite[];
}

export interface StyledCell {
  glyph: string;
  styleToken: StyleToken;
}

export interface StyledSegment {
  text: string;
  styleToken: StyleToken;
}

export function makeFrame(lines: readonly string[], duration = 1): Frame {
  return { lines, duration };
}

export function makeSprite(
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

export function makeAnimatedSprite({
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

export function frameForSprite(sprite: Sprite, timeline: AnimationTimeline): readonly string[] {
  const duration = Math.max(1, sprite.frameDuration);
  const index = Math.floor(timeline.frame / duration) % sprite.frames.length;
  return sprite.frames[index]?.lines ?? [];
}

export function blankCellRow(width: number, styleToken: StyleToken = "background"): StyledCell[] {
  return Array.from({ length: width }, () => ({ glyph: " ", styleToken }));
}

export function overlayCellLine(
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

export function composeSceneCells(scene: Scene, timeline: AnimationTimeline): StyledCell[][] {
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

export function styledCellsToSegments(cells: readonly StyledCell[]): StyledSegment[] {
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

export function composeStyledScene(scene: Scene, timeline: AnimationTimeline): StyledSegment[][] {
  return composeSceneCells(scene, timeline).map(styledCellsToSegments);
}

// ─── stat / activity helpers shared by scene + compact panel ─────────────────

export interface WorstStat {
  key: "hunger" | "happiness" | "energy" | "deals";
  value: number;
}

export function pickWorstStat(stats: PetStats): WorstStat {
  const entries: WorstStat[] = [
    { key: "hunger", value: stats.hunger },
    { key: "happiness", value: stats.happiness },
    { key: "energy", value: stats.energy },
    { key: "deals", value: stats.deals },
  ];
  return entries.reduce((best, cur) => (cur.value < best.value ? cur : best));
}

export function activityStatusToken(activity: PetActivity, frame: number): string {
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
