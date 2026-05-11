import { Box, Text } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import { getPetMood, type PetActivity, type PetStats } from "../pet/petState.ts";
import {
  BRIEFCASE_FINAL,
  MASCOT_WIDTH,
  renderMascotLines,
  type MascotState,
} from "./MascotFrame.tsx";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";
import { type Theme } from "./themes.ts";

export const COMPACT_PET_PANEL_ROWS = 5;
export const TINY_PET_PANEL_ROWS = 1;
export const COMPACT_PET_PANEL_MIN_WIDTH = 48;
export type Environment = "office" | "home" | "outdoors";

const PANEL_BORDER_COLUMNS = 2;
const PANEL_PADDING_COLUMNS = 2;
const SCENE_ROWS = 18;
// Row map for the redesigned office scene.
// 0     title bar  (DREXLER OFFICE · stat readout)
// 1     window top border
// 2     sky band (sun/moon, drifting cloud)
// 3     skyscraper rooflines
// 4     skyscraper upper-window grid
// 5     skyscraper lower-window grid
// 6     window bottom border (date / time stamp)
// 7     breathing row (negative space anchor)
// 8-14  mascot (BRIEFCASE_FINAL is 7 rows)
// 15    desk horizon + " DESK " label
// 16    desktop props (nameplate, steaming mug)
// 17    memo / status line
const R_TITLE = 0;
const R_WIN_TOP = 1;
const R_WIN_SKY = 2;
const R_WIN_TOPS = 3;
const R_WIN_MID = 4;
const R_WIN_BASE = 5;
const R_WIN_BOTTOM = 6;
const R_MASCOT_START = 8;
const R_DESK_LINE = R_MASCOT_START + BRIEFCASE_FINAL.length;
const R_DESK_PROPS = R_DESK_LINE + 1;
const R_MEMO = R_DESK_PROPS + 1;

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

function overlayFitted(row: string, text: string, x: number, width: number): string {
  return place(row, padDisplayText(text, width), x);
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

// Skyscraper recipe. Each entry is one tower placed left-to-right with
// roof / upper-windows / lower-windows rows of equal width. The window
// pattern repeats every `period` columns. `period` and `lit` step the
// flicker over time so the lit windows rotate without ever changing the
// tower silhouette.
interface SkyscraperRecipe {
  width: number;
  gap: number;
  // Roofline glyphs. We pad with the building's edge fill below.
  roof: (width: number) => string;
  upper: (width: number, frame: number, period: number) => string;
  lower: (width: number, frame: number, period: number) => string;
  period: number;
}

function repeatPattern(width: number, period: number, picker: (i: number) => string): string {
  let out = "";
  for (let i = 0; i < width; i++) out += picker(i % period);
  return out;
}

function skyscraperTops(width: number): string {
  // ▆▇ produces a fuller roof; flat parapets at the ends keep silhouettes square.
  if (width <= 2) return "▇".repeat(width);
  if (width <= 4) return "▆" + "▇".repeat(width - 2) + "▆";
  return "▆▇" + "▇".repeat(width - 4) + "▇▆";
}

function skyscraperUpper(width: number, frame: number, period: number): string {
  // Two-glyph alternation █▒ with a slow flicker swap that lights one
  // window per tower every 4 frames. ░ reads as "lit" against ▒ "dim".
  const lit = Math.floor(frame / 3) % period;
  return repeatPattern(width, period, (col) => {
    const base = col % 2 === 0 ? "█" : "▒";
    if (col === lit) return col % 2 === 0 ? "█" : "░";
    return base;
  });
}

function skyscraperLower(width: number, frame: number, period: number): string {
  // Offset flicker phase from the upper grid so the two rows feel
  // independent without ever looking chaotic.
  const lit = (Math.floor(frame / 3) + 1) % period;
  return repeatPattern(width, period, (col) => {
    const base = col % 2 === 0 ? "█" : "▒";
    if (col === lit) return col % 2 === 0 ? "█" : "░";
    return base;
  });
}

const SKYLINE_RECIPE: ReadonlyArray<SkyscraperRecipe> = [
  { width: 4, gap: 2, period: 4, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 6, gap: 2, period: 4, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 3, gap: 2, period: 3, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 7, gap: 2, period: 6, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 4, gap: 2, period: 4, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 5, gap: 3, period: 4, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
  { width: 3, gap: 2, period: 3, roof: skyscraperTops, upper: skyscraperUpper, lower: skyscraperLower },
];

function buildSkylineRows(width: number, frame: number): {
  tops: string;
  upper: string;
  lower: string;
} {
  // Compose left-to-right until we run out of room. Pad with spaces so
  // the silhouette doesn't extend past the inner canvas width.
  let tops = "";
  let upper = "";
  let lower = "";
  let cursor = 0;
  for (const tower of SKYLINE_RECIPE) {
    if (cursor + tower.width > width) break;
    tops += tower.roof(tower.width);
    upper += tower.upper(tower.width, frame, tower.period);
    lower += tower.lower(tower.width, frame, tower.period);
    cursor += tower.width;
    const gap = Math.min(tower.gap, Math.max(0, width - cursor));
    if (gap > 0) {
      tops += " ".repeat(gap);
      upper += " ".repeat(gap);
      lower += " ".repeat(gap);
      cursor += gap;
    }
  }
  const remainder = Math.max(0, width - cursor);
  return {
    tops: tops + " ".repeat(remainder),
    upper: upper + " ".repeat(remainder),
    lower: lower + " ".repeat(remainder),
  };
}

function progressTicker(frame: number): string {
  const dots = ".............";
  const idx = frame % dots.length;
  return `[${dots.slice(0, idx)}o${dots.slice(idx + 1)}]`;
}

function buildActivityLine(activity: PetActivity, frame: number): string {
  switch (activity) {
    case "eating":
      return frame % 4 < 2
        ? "deal snack memo routed"
        : "lunch marked to market";
    case "playing":
      return frame % 6 < 3
        ? "boardroom putting drill"
        : "team morale accretive";
    case "working":
      return `term sheet live ${progressTicker(frame)}`;
    case "sleeping":
      return frame % 4 < 2
        ? "lights dim · conference-line nap"
        : "zzz · calendar defended";
    case "praised":
      return frame % 2 === 0
        ? "bonus memo approved * * *"
        : "* * * board applause logged";
    case "vibing":
      return ["lo-fi deal room ~ ~ ~", "~ ~ valuation waves ~ ~"][frame % 2]!;
    default:
      return "calendar clear · office quiet";
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

function drawTitleBar(rows: string[], width: number, stats: PetStats): void {
  // Single-line title bar: "─ DREXLER OFFICE ─ … ─ deals 38% ─" with
  // padded glyphs around each segment so the eye reads them as labels
  // on a rule, not a rule running through text. The right-aligned
  // readout names the most-pressing stat. Avoids the previous chrome
  // echo where the same percentage appeared in both the title and the
  // desk strip.
  const label = " DREXLER OFFICE ";
  const worst = pickWorstStat(stats);
  const readout = ` ${worst.key} ${Math.round(worst.value)}% `;
  rows[R_TITLE] = centerText("─".repeat(width), label);
  rows[R_TITLE] = place(
    rows[R_TITLE],
    fitDisplayText(readout, Math.max(1, width - 2)),
    Math.max(0, width - displayWidth(readout) - 1),
  );
}

function clockFromFrame(frame: number): string {
  // Slow ambient clock — advances roughly one minute every 5 frames.
  const startHour = 9; // boardroom opens at 9 AM corporate time.
  const totalMinutes = startHour * 60 + Math.floor(frame / 5);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function drawBoardroomWindow(
  rows: string[],
  width: number,
  frame: number,
  stats: PetStats,
  activity: PetActivity,
): void {
  // Outer rounded window frame spans nearly the full panel width. The
  // city skyline lives entirely inside the frame; nothing else competes
  // with it for upper-half attention.
  const winX = 1;
  const winWidth = Math.max(20, width - 2);
  const innerWidth = Math.max(8, winWidth - 2);

  // Top frame carries a quiet label so the eye knows what it's looking at.
  const topLabel = ` Skyline · ${clockFromFrame(frame)} `;
  const topRuleWidth = Math.max(0, innerWidth - displayWidth(topLabel));
  rows[R_WIN_TOP] = place(
    rows[R_WIN_TOP],
    `╭${topLabel}${"─".repeat(topRuleWidth)}╮`,
    winX,
  );

  // Sky row: sun/moon left, drifting cloud right, otherwise empty so
  // the skyline has clean air to breathe.
  const sunGlyph = frame % 24 < 12 ? "☼" : "☾";
  const cloudOffset = (Math.floor(frame / 2) % (innerWidth - 6)) + 2;
  let sky = " ".repeat(innerWidth);
  sky = place(sky, sunGlyph, 1);
  sky = place(sky, "(~~)", cloudOffset);
  rows[R_WIN_SKY] = place(rows[R_WIN_SKY], `│${sky}│`, winX);

  // Skyscrapers. Centered horizontally inside the inner canvas so the
  // skyline reads as one continuous silhouette.
  const skylineWidth = Math.max(8, innerWidth - 4);
  const { tops, upper, lower } = buildSkylineRows(skylineWidth, frame);
  const padLeft = Math.max(0, Math.floor((innerWidth - skylineWidth) / 2));
  const padRight = Math.max(0, innerWidth - padLeft - skylineWidth);
  const wrapSkylineRow = (row: string): string =>
    `│${" ".repeat(padLeft)}${row}${" ".repeat(padRight)}│`;
  rows[R_WIN_TOPS] = place(rows[R_WIN_TOPS], wrapSkylineRow(tops), winX);
  rows[R_WIN_MID] = place(rows[R_WIN_MID], wrapSkylineRow(upper), winX);
  rows[R_WIN_BASE] = place(rows[R_WIN_BASE], wrapSkylineRow(lower), winX);

  // Bottom frame restates the current activity for at-a-glance status.
  const bottomLabel = ` ${buildActivityLine(activity, frame)} · DL ${Math.round(stats.deals).toString().padStart(3)}% `;
  const fittedBottom = fitDisplayText(bottomLabel, Math.max(1, innerWidth - 2));
  const bottomRuleWidth = Math.max(0, innerWidth - displayWidth(fittedBottom));
  rows[R_WIN_BOTTOM] = place(
    rows[R_WIN_BOTTOM],
    `╰${fittedBottom}${"─".repeat(bottomRuleWidth)}╯`,
    winX,
  );
}

function drawActivityAccents(
  rows: string[],
  width: number,
  activity: PetActivity,
  _frame: number,
  mascotX: number,
): void {
  // Accents are now small, single-glyph flourishes positioned in the
  // empty cells immediately flanking the mascot. No competing props,
  // so accents always have clean space to land on.
  const mascotRight = mascotX + MASCOT_WIDTH;
  const leftAccentX = Math.max(1, mascotX - 4);
  const rightAccentX = Math.min(width - 2, mascotRight + 2);

  switch (activity) {
    case "eating":
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "[$]", rightAccentX);
      break;
    case "playing":
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "*", leftAccentX);
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "*", rightAccentX);
      break;
    case "working":
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "$", leftAccentX);
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "$", rightAccentX);
      break;
    case "sleeping":
      rows[R_MASCOT_START] = place(rows[R_MASCOT_START], "z z Z", rightAccentX);
      break;
    case "praised":
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "* *", leftAccentX);
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "* *", rightAccentX);
      break;
    case "vibing":
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "~ ~", leftAccentX);
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "~ ~", rightAccentX);
      break;
    default:
      break;
  }
}

function drawMascot(rows: string[], width: number, activity: PetActivity, frame: number): number {
  const mascot = renderMascotLines(mascotStateForActivity(activity, frame));
  const mascotX = Math.max(0, Math.floor((width - MASCOT_WIDTH) / 2));
  for (let i = 0; i < mascot.length; i++) {
    rows[R_MASCOT_START + i] = place(
      rows[R_MASCOT_START + i] ?? blankRow(width),
      mascot[i] ?? "",
      mascotX,
    );
  }
  return mascotX;
}

function drawDeskHorizon(rows: string[], width: number): void {
  // One quiet horizon line anchors the mascot in the room. The
  // " DESK " label sits at the rule's center and identifies the
  // working surface without needing a bordered strip below.
  const label = " DREXLER DEAL DESK ";
  const fitted = fitDisplayText(label, Math.max(1, width - 4));
  const labelWidth = displayWidth(fitted);
  const leftRule = Math.max(2, Math.floor((width - labelWidth) / 2));
  const rightRule = Math.max(2, width - leftRule - labelWidth);
  rows[R_DESK_LINE] = `${"─".repeat(leftRule)}${fitted}${"─".repeat(rightRule)}`;
}

function drawDeskProps(
  rows: string[],
  width: number,
  activity: PetActivity,
  frame: number,
  stats: PetStats,
): void {
  // Two props only: the mascot nameplate on the left and a coffee mug
  // on the right. Both sit on the desk-props row so they share a
  // baseline with the mascot above and never float.
  const mascotX = Math.max(0, Math.floor((width - MASCOT_WIDTH) / 2));
  const mascotRight = mascotX + MASCOT_WIDTH;
  const nameplateX = Math.max(2, mascotX - 12);
  const mugX = Math.min(width - 6, mascotRight + 4);
  const cursorAt = activity === "working" && frame % 2 === 0 ? "_" : " ";
  const namePlate = activity === "sleeping" ? "▭ zzz " : `▭ DREX${cursorAt}`;
  rows[R_DESK_PROPS] = place(rows[R_DESK_PROPS], namePlate, nameplateX);
  if (mugX > mascotRight + 1) {
    // Steam wisp lives on the desk horizon row, just above the mug.
    // Letting it tick frame-by-frame gives the room one quiet ambient
    // beat without competing with the skyline flicker.
    const steam = stats.energy > 30
      ? frame % 4 < 2 ? " ((" : "  ))"
      : "";
    if (steam) {
      rows[R_DESK_LINE] = place(rows[R_DESK_LINE], steam, mugX + 1);
    }
    rows[R_DESK_PROPS] = place(rows[R_DESK_PROPS], `╭${cupForEnergy(stats.energy)}╮`, mugX);
  }
}

function drawMemo(rows: string[], width: number, stats: PetStats, frame: number): void {
  // Memo row carries the rotating status message. Centered, dim — the
  // closing punctuation of the scene rather than a competing chrome
  // strip with its own border.
  const memo = `· ${getStatusMsg(stats, frame)} ·`;
  rows[R_MEMO] = centerText(" ".repeat(width), fitDisplayText(memo, width));
}

function buildScene(
  activity: PetActivity,
  frame: number,
  stats: PetStats,
  width: number,
): string[] {
  const sceneWidth = Math.max(PET_SCENE_WIDTH, Math.floor(width));
  const rows: string[] = Array.from({ length: SCENE_ROWS }, () => blankRow(sceneWidth));

  drawTitleBar(rows, sceneWidth, stats);
  drawBoardroomWindow(rows, sceneWidth, frame, stats, activity);
  const mascotX = drawMascot(rows, sceneWidth, activity, frame);
  drawDeskHorizon(rows, sceneWidth);
  drawDeskProps(rows, sceneWidth, activity, frame, stats);
  drawMemo(rows, sceneWidth, stats, frame);
  drawActivityAccents(rows, sceneWidth, activity, frame, mascotX);
  return rows.map((row) => overlayFitted(blankRow(sceneWidth), row, 0, sceneWidth));
}

// ─── row colors ───────────────────────────────────────────────────────────────
// Four-stop brightness ladder so the eye finds a hierarchy:
//   dim          → chrome (title rule, memo)
//   primaryDim   → window frame, desk horizon, skyline silhouettes
//   primary      → desk props, mascot body
//   primaryLight → mascot eyes + activity accents
function rowColor(i: number, activity: PetActivity, frame: number, t: Theme): string {
  if (i >= R_MASCOT_START && i < R_MASCOT_START + BRIEFCASE_FINAL.length) {
    if (activity === "sleeping") return t.dim;
    if (activity === "praised")  return t.primaryLight;
    if (activity === "eating")   return t.warning;
    if (activity === "playing")  return frame % 6 >= 3 ? t.primaryLight : t.primary;
    if (activity === "working" && frame % 32 >= 26) return t.error;
    return t.primary;
  }
  if (i === R_TITLE) return t.dim;
  if (i === R_WIN_SKY) return t.dim;
  if (i === R_WIN_TOPS || i === R_WIN_MID || i === R_WIN_BASE) return t.primaryDim;
  if (i === R_WIN_TOP || i === R_WIN_BOTTOM) return t.primaryDim;
  if (i === R_DESK_LINE) return t.primaryDim;
  if (i === R_DESK_PROPS) return t.primary;
  if (i === R_MEMO) {
    if (activity === "working" && frame % 32 >= 26) return t.error;
    if (activity === "sleeping")  return t.dim;
    if (activity === "praised")   return t.warning;
    if (activity === "eating")    return t.warning;
    if (activity === "playing")   return t.primaryLight;
    return t.dim;
  }
  return t.primaryDim;
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
    () => buildScene(activity, frame, stats, sceneWidth),
    [activity, frame, sceneWidth, stats],
  );

  return (
    <Box flexDirection="column" width={sceneWidth} flexShrink={0}>
      {scene.map((row, i) => (
        <Text key={i} color={rowColor(i, activity, frame, t)}>{row}</Text>
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
