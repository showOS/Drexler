import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { PetActivity, PetStats } from "../../pet/petState.ts";
import {
  BRIEFCASE_FINAL,
  MASCOT_WIDTH,
  renderMascotLines,
  type MascotState,
} from "../MascotFrame.tsx";
import { displayWidth, fitDisplayText } from "../graphemes.ts";
import { useTheme } from "../ThemeContext.tsx";
import { type Theme } from "../themes.ts";
import { analogClockLines } from "./AsciiClock.tsx";
import { marketBoardLines } from "./MarketBoard.tsx";
import {
  activityStatusToken,
  blankRow,
  boxBottom,
  boxContent,
  boxTop,
  centerText,
  composeStyledScene,
  makeAnimatedSprite,
  makeSprite,
  padDisplayText,
  pickWorstStat,
  place,
  placeRight,
  plainBoxTop,
  type AnimationTimeline,
  type Scene,
  type SceneState,
  type Sprite,
  type StyledSegment,
  type StyleToken,
} from "./shared.ts";

export type Environment = "office" | "home" | "outdoors";

export const PET_SCENE_ROWS = 33;
export const PET_SCENE_WIDTH = 52;

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

function cupForEnergy(energy: number): string {
  if (energy > 60) return "c~";
  if (energy > 30) return "c-";
  return "c_";
}

type SceneLayout = "compact" | "standard" | "wide";

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
  const stageWidth = Math.max(1, Math.min(maxStageWidth, Math.max(1, width - sidePad * 2)));
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
  const boardWidth =
    layout === "compact" ? stageWidth : Math.max(44, stageWidth - windowWidth - boardGap);
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

function lampLines(activity: PetActivity, frame: number): string[] {
  const rays = activity === "sleeping" ? "    │    " : frame % 6 < 3 ? "   ╲│╱   " : "   ╱│╲   ";
  return [rays, "  ╭───╮  ", " ╭╯   ╰╮ ", " ╰──┬──╯ ", "    │    ", "   ═╧═   "];
}

function statusCardLines(
  width: number,
  activity: PetActivity,
  frame: number,
  stats: PetStats,
): string[] {
  const status = activityStatusToken(activity, frame);
  const motto =
    activity === "working"
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
  return ["╭────────╮", "│ ▤▤▤▤   │", `${tab}────────┤`, "│ ▤▤▤▤   │", "╰────────╯"];
}

function wallRailLine(width: number, activity: PetActivity, frame: number): string {
  const trim = activity === "working" && frame % 2 === 0 ? "─╴╴─" : "────";
  return centerText("─".repeat(width), trim);
}

function deskJoinLine(
  width: number,
  leftCorner: string,
  midA: string,
  midB: string,
  rightCorner: string,
): string {
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
  row = place(row, fittedCenter, centerX);
  row = placeRight(row, right, 2);
  return `│${row}│`;
}

function deskBaseLines(width: number, stats: PetStats, activity: PetActivity): string[] {
  const inner = Math.max(1, width - 2);
  const covenants = stats.happiness < 30 || stats.energy < 25 ? "WARN" : "OK";
  const close = activity === "praised" ? "COMPOUND" : activity === "working" ? "EXEC" : "WATCH";
  const pipe = Math.round(stats.deals);
  const fascia =
    width < 64 ? "DREXLER DESK" : width < 84 ? "DREXLER DEAL DESK" : "DREXLER DEAL DESK";
  const readout = width < 64 ? `PIPE ${pipe}%` : `PIPE ${pipe}%  COV ${covenants}  ${close}`;
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
    return [["       ", "       ", `  ${cup}`]];
  }
  return [
    ["  (  ) ", " (    )", `  ${cup}`],
    [" (    )", "  (  ) ", `  ${cup}`],
    ["  )  ( ", " (    )", `  ${cup}`],
  ];
}

function memoFrames(activity: PetActivity): readonly (readonly string[])[] {
  const idle = ["╭────────╮", "│ memo ╲ │", "│ ────   │", "╰────────╯"];
  const working = ["╭────────╮", "│ memo ╱ │", "│ ───    │", "╰────────╯"];
  const success = ["╭────────╮", "│ done ✓ │", "│ ───    │", "╰────────╯"];

  if (activity === "praised") return [success];
  if (activity === "working") return [idle, working];
  return [idle];
}

function keyboardFrames(activity: PetActivity): readonly (readonly string[])[] {
  const idle = ["┌────────────┐", "│ ▄ ▄ ▄ ▄ ▄ │", "└────────────┘"];
  const active = ["┌────────────┐", "│ ▄ ▀ ▄ ▀ ▄ │", "└────────────┘"];
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

  sprites.push(
    makeSprite("background:title", 0, 0, R_TITLE, [titleLine(width, stats)], "background"),
  );
  const clock = analogClockLines(frame);
  sprites.push(
    makeSprite(
      "wall:clock",
      12,
      Math.max(0, Math.floor((width - displayWidth(clock[0] ?? "")) / 2)),
      R_CLOCK_TOP,
      clock,
      "secondaryLine",
    ),
  );

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

  sprites.push(
    makeSprite(
      "wall:rail",
      8,
      metrics.stageX,
      R_WALL_RAIL,
      [wallRailLine(metrics.stageWidth, activity, frame)],
      "secondaryLine",
    ),
  );

  if (layout !== "compact") {
    sprites.push(
      makeAnimatedSprite({
        id: "lamp:side",
        zIndex: 30,
        x: metrics.stageX + 2,
        y: R_MASCOT_START,
        frames: [lampLines(activity, frame), lampLines(activity, frame + 3)],
        frameDuration: 2,
        styleToken: "lampGlow",
      }),
    );
  }

  if (layout === "wide" && width >= 118) {
    sprites.push(
      makeSprite(
        "status:card",
        30,
        Math.max(metrics.stageX, metrics.stageX + metrics.stageWidth - 21),
        R_MASCOT_START + 1,
        statusCardLines(20, activity, frame, stats),
        "statusAccent",
      ),
    );
  }

  if (layout === "wide" && width >= 132) {
    sprites.push(
      makeAnimatedSprite({
        id: "storage:file-cabinet",
        zIndex: 35,
        x: Math.max(metrics.stageX, metrics.stageX + metrics.stageWidth - 32),
        y: R_DESK_LINE - 6,
        frames: [fileCabinetLines(frame), fileCabinetLines(frame + 2)],
        frameDuration: 3,
        styleToken: "secondaryLine",
      }),
    );
  }

  sprites.push(
    makeAnimatedSprite({
      id: "drexler:mascot",
      zIndex: 50,
      x: mascotX,
      y: mascotY,
      frames: [renderMascotLines(mascotStateForActivity(activity, frame))],
      frameDuration: 3,
      styleToken: "drexlerOutline",
    }),
  );

  sprites.push(
    makeSprite(
      "desk:foreground",
      80,
      deskX,
      R_DESK_LINE,
      deskBaseLines(deskWidth, stats, activity),
      "deskLine",
      false,
    ),
  );

  sprites.push(
    makeSprite(
      "drexler:money-panel",
      95,
      mascotX + 6,
      Math.min(mascotY + 5, R_DESK_LINE - 1),
      [activity === "sleeping" ? "║ ░░ ║" : "║ $$ ║"],
      activity === "praised" ? "statusAccent" : "drexlerOutline",
      false,
    ),
  );

  sprites.push(
    makeAnimatedSprite({
      id: "desk:coffee",
      zIndex: 90,
      x: deskX + 3,
      y: R_DESK_PROPS,
      frames: coffeeFrameSet,
      frameDuration: activity === "sleeping" ? 5 : 2,
      styleToken: "statusAccent",
      parentAnchor: "desk:foreground",
      transparentSpaces: true,
    }),
  );

  sprites.push(
    makeAnimatedSprite({
      id: "desk:memo",
      zIndex: 90,
      x: Math.max(deskX + 12, metrics.centerX - 7),
      y: R_DESK_PROPS,
      frames: memoFrameSet,
      frameDuration: 2,
      styleToken: "primaryLine",
      parentAnchor: "desk:foreground",
      transparentSpaces: false,
    }),
  );

  const keyboardWidth = displayWidth(keyboardFrameSet[0]?.[0] ?? "");
  sprites.push(
    makeAnimatedSprite({
      id: "desk:keyboard",
      zIndex: 90,
      x: Math.min(deskX + deskWidth - 2 - keyboardWidth, metrics.centerX + 13),
      y: R_DESK_PROPS,
      frames: keyboardFrameSet,
      frameDuration: activity === "working" ? 1 : 3,
      styleToken: "primaryLine",
      parentAnchor: "desk:foreground",
      transparentSpaces: false,
    }),
  );

  const accent = activityAccentLines(activity, frame);
  if (accent[0]) {
    sprites.push(
      makeSprite(
        "effect:status",
        100,
        Math.min(width - displayWidth(accent[0] ?? ""), mascotX + MASCOT_WIDTH + 2),
        R_MASCOT_START + 3,
        accent,
        "statusAccent",
      ),
    );
  }

  sprites.push(
    makeSprite("floor:shadow", 2, 0, R_FLOOR_SHADOW, floorShadowLines(width), "background"),
  );

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

// ─── component ────────────────────────────────────────────────────────────────

interface PetSceneProps {
  stats: PetStats;
  activity: PetActivity;
  env?: Environment;
  isPaused?: boolean;
  width?: number;
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
