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
const SCENE_ROWS = 14;
const R_WALL = 0;
const R_WINDOW_TOP = 1;
const R_WINDOW_BOTTOM = 3;
const R_ACTIVITY = 4;
const R_MASCOT_START = 5;
const R_DESK_SURFACE = R_MASCOT_START + BRIEFCASE_FINAL.length;
const R_DESK_FRONT = R_DESK_SURFACE + 1;

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

function sceneBoxTop(title: string, width: number): string {
  const safeWidth = Math.max(4, width);
  const label = ` ${fitDisplayText(title, Math.max(1, safeWidth - 4))} `;
  const ruleWidth = Math.max(0, safeWidth - 2 - displayWidth(label));
  return `╭${label}${"─".repeat(ruleWidth)}╮`;
}

function sceneBoxBody(text: string, width: number): string {
  const safeWidth = Math.max(4, width);
  return `│${padDisplayText(text, safeWidth - 2)}│`;
}

function sceneBoxBottom(width: number): string {
  const safeWidth = Math.max(4, width);
  return `╰${"─".repeat(safeWidth - 2)}╯`;
}

function placeSceneBox(
  rows: string[],
  row: number,
  x: number,
  width: number,
  title: string,
  body: string,
): void {
  rows[row] = place(rows[row] ?? "", sceneBoxTop(title, width), x);
  rows[row + 1] = place(rows[row + 1] ?? "", sceneBoxBody(body, width), x);
  rows[row + 2] = place(rows[row + 2] ?? "", sceneBoxBottom(width), x);
}

function cupForEnergy(energy: number): string {
  if (energy > 60) return "coffee [c~]";
  if (energy > 30) return "coffee [c-]";
  return "coffee [c_]";
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

function drawOfficeBackground(rows: string[], width: number, frame: number, stats: PetStats): void {
  const wallLabel = "DREXLER OFFICE";
  const dealPct = `${Math.round(stats.deals).toString().padStart(3)}%`;
  rows[R_WALL] = centerText("─".repeat(width), wallLabel);
  rows[R_WALL] = place(
    rows[R_WALL],
    fitDisplayText(`pipe ${dealPct}`, Math.max(1, width - 2)),
    Math.max(0, width - displayWidth(`pipe ${dealPct}`) - 1),
  );

  const windowWidth = Math.min(22, Math.max(16, Math.floor(width * 0.36)));
  const boardWidth = Math.min(28, Math.max(20, width - windowWidth - 6));
  const boardX = Math.max(windowWidth + 4, width - boardWidth - 2);
  const marketPulse = frame % 10 < 5 ? "market tape  + + +" : "market tape  +  +";

  placeSceneBox(rows, R_WINDOW_TOP, 1, windowWidth, "Market Window", marketPulse);
  placeSceneBox(
    rows,
    R_WINDOW_TOP,
    boardX,
    Math.min(boardWidth, width - boardX),
    "Deal Board",
    `DL:${dealPct}  fees:${Math.round(stats.happiness)}%`,
  );

  rows[R_ACTIVITY] = centerText(
    "─".repeat(width),
    buildActivityLine("idle", frame),
  );
}

function drawActivityAccents(
  rows: string[],
  width: number,
  activity: PetActivity,
  frame: number,
  mascotX: number,
): void {
  rows[R_ACTIVITY] = centerText(
    "─".repeat(width),
    buildActivityLine(activity, frame),
  );

  const mascotRight = mascotX + MASCOT_WIDTH;
  const leftAccentX = Math.max(1, mascotX - 10);
  const rightAccentX = Math.min(width - 10, mascotRight + 2);

  switch (activity) {
    case "eating":
      rows[R_DESK_SURFACE] = place(rows[R_DESK_SURFACE], "[$ memo]", rightAccentX);
      break;
    case "playing":
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "*", leftAccentX);
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "*", rightAccentX + 6);
      break;
    case "working":
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "$", leftAccentX);
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "$", rightAccentX + 6);
      break;
    case "sleeping":
      rows[R_MASCOT_START] = place(rows[R_MASCOT_START], "z z Z", rightAccentX);
      break;
    case "praised":
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "* *", leftAccentX);
      rows[R_MASCOT_START + 1] = place(rows[R_MASCOT_START + 1], "* *", rightAccentX + 4);
      break;
    case "vibing":
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "~ ~", leftAccentX);
      rows[R_MASCOT_START + 3] = place(rows[R_MASCOT_START + 3], "~ ~", rightAccentX + 4);
      break;
    default:
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "[IN]", 2);
      rows[R_MASCOT_START + 2] = place(rows[R_MASCOT_START + 2], "[OUT]", Math.max(2, width - 8));
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

function drawDesk(rows: string[], width: number, stats: PetStats): void {
  const deskX = width > PET_SCENE_WIDTH ? 2 : 1;
  const deskWidth = Math.max(4, width - deskX * 2);
  const deskInner = Math.max(1, deskWidth - 2);
  const surface = `laptop [▣]  papers [///]  ${cupForEnergy(stats.energy)}`;
  const front = `DESK  pipeline ${Math.round(stats.deals)}%  covenants OK`;

  rows[R_DESK_SURFACE] = place(
    rows[R_DESK_SURFACE],
    `╭${padDisplayText(surface, deskInner)}╮`,
    deskX,
  );
  rows[R_DESK_FRONT] = place(
    rows[R_DESK_FRONT],
    `╰${padDisplayText(front, deskInner)}╯`,
    deskX,
  );
}

function buildScene(
  activity: PetActivity,
  frame: number,
  stats: PetStats,
  width: number,
): string[] {
  const sceneWidth = Math.max(PET_SCENE_WIDTH, Math.floor(width));
  const rows: string[] = Array.from({ length: SCENE_ROWS }, () => blankRow(sceneWidth));

  drawOfficeBackground(rows, sceneWidth, frame, stats);
  drawDesk(rows, sceneWidth, stats);
  const mascotX = drawMascot(rows, sceneWidth, activity, frame);
  drawActivityAccents(rows, sceneWidth, activity, frame, mascotX);
  return rows.map((row) => overlayFitted(blankRow(sceneWidth), row, 0, sceneWidth));
}

// ─── row colors ───────────────────────────────────────────────────────────────
function rowColor(i: number, activity: PetActivity, frame: number, t: Theme): string {
  if (i >= R_MASCOT_START && i < R_MASCOT_START + BRIEFCASE_FINAL.length) {
    if (activity === "sleeping") return t.dim;
    if (activity === "praised")  return t.primaryLight;
    if (activity === "eating")   return t.warning;
    if (activity === "playing")  return frame % 6 >= 3 ? t.primaryLight : t.primary;
    if (activity === "working" && frame % 32 >= 26) return t.error;
    return t.primary;
  }
  if (i === R_ACTIVITY) {
    if (activity === "working" && frame % 32 >= 26) return t.error;
    if (activity === "sleeping")  return t.dim;
    if (activity === "praised")   return t.warning;
    if (activity === "eating")    return t.warning;
    if (activity === "playing")   return t.primaryLight;
    return t.primaryLight;
  }
  if (i === R_DESK_SURFACE || i === R_DESK_FRONT) return t.primaryDim;
  if (i === R_WALL) return t.dim;
  if (i >= R_WINDOW_TOP && i <= R_WINDOW_BOTTOM) return t.primaryDim;
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
