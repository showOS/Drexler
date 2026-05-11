import { Box, Text } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import { getPetMood, type PetActivity, type PetStats } from "../pet/petState.ts";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";
import { type Theme } from "./themes.ts";

export const PET_PANEL_WIDTH = 36;
export const PET_PANEL_ROWS = 22;
export type Environment = "office" | "home" | "outdoors";

const PANEL_BORDER_COLUMNS = 2;
const PANEL_PADDING_COLUMNS = 2;
const CONTENT = PET_PANEL_WIDTH - PANEL_BORDER_COLUMNS - PANEL_PADDING_COLUMNS;
const SPRITE_W = 8;

const R_SKY   = 0;
const R_BGA   = 1;
const R_BGB   = 2;
const R_DECO  = 3;
const R_SP0   = 4;  // sprite occupies rows 4–9
const R_FLOOR = 10;
const SCENE_ROWS = 11;

// Fixed sprite X — no left/right walking
const SPRITE_X: Record<PetActivity, number> = {
  idle: 12, eating: 3, playing: 12, working: 18,
  sleeping: 12, praised: 12, vibing: 12,
};

// ─── helpers ─────────────────────────────────────────────────────────────────
// All scene glyphs (box-drawing + ASCII) are BMP single-units, so string
// splicing is safe and avoids the per-call char-array allocation `[...base]`
// would do on the hot frame loop.
function place(base: string, text: string, x: number): string {
  if (x < 0 || x >= base.length) return base;
  const end = Math.min(base.length, x + text.length);
  const fit = text.slice(0, end - x);
  return base.slice(0, x) + fit + base.slice(end);
}
function pad(s: string, n: number): string {
  const fitted = fitDisplayText(s, n);
  return fitted + " ".repeat(Math.max(0, n - displayWidth(fitted)));
}

// Hoisted constant: floor pattern for home doesn't depend on frame.
const HOME_CARPET = Array.from({ length: CONTENT }, (_, i) =>
  i % 4 === 0 ? "░" : i % 4 === 2 ? "▒" : "─",
).join("");

// ─── sprite (8 wide × 6 tall) ────────────────────────────────────────────────
function buildSprite(activity: PetActivity, frame: number): string[] {
  const smash = activity === "working" && frame % 32 >= 26;

  let eyes: string;
  if (smash) eyes = "║ X  X ║";
  else switch (activity) {
    case "sleeping": eyes = "║ -  - ║"; break;
    case "working":  eyes = "║ /  \\ ║"; break;
    case "playing":  eyes = frame % 6 < 3 ? "║ *  * ║" : "║ ◆  ◆ ║"; break;
    case "vibing":   eyes = frame % 4 < 2 ? "║ ~  ~ ║" : "║ ◆  ◆ ║"; break;
    case "eating":   eyes = frame % 4 < 2 ? "║ o  o ║" : "║ ◆  ◆ ║"; break;
    case "praised":  eyes = "║ ◆  ◆ ║"; break;
    default:         eyes = frame % 22 === 0 ? "║ -  - ║" : "║ ◆  ◆ ║"; break;
  }

  // Flex top during playing peak
  const top = (activity === "playing" && frame % 6 >= 3) ? "╠═╩══╩═╣" : "╔═╩══╩═╗";

  let lock: string;
  if (smash) lock = "║ ║**║ ║";
  else switch (activity) {
    case "eating":   lock = frame % 2 === 0 ? "║ ║>>║ ║" : "║ ║<<║ ║"; break;
    case "sleeping": lock = "║      ║"; break;
    case "praised":  lock = frame % 3 === 0 ? "║ ║**║ ║" : "║ ║$$║ ║"; break;
    case "vibing":   lock = frame % 4 < 2   ? "║ ║~~║ ║" : "║ ║$$║ ║"; break;
    case "playing":  lock = frame % 4 < 2   ? "║ ║!!║ ║" : "║ ║$$║ ║"; break;
    default:         lock = "║ ║$$║ ║"; break;
  }

  return [
    "  ╔══╗  ",
    top,
    eyes,
    activity === "sleeping" ? "║      ║" : "║ ╔══╗ ║",
    lock,
    "╚══════╝",
  ];
}

// ─── environments (simplified) ───────────────────────────────────────────────

function drawOffice(rows: string[], frame: number, stats: PetStats): void {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;

  rows[R_SKY] = "─".repeat(CONTENT);

  // Window left (6 wide) + deals board right (12 wide at x=20)
  const sky = isDay
    ? (frame % 10 < 5 ? "─^──" : "──^─")
    : (frame % 10 < 5 ? "─*──" : "──*─");
  rows[R_BGA] = place(rows[R_BGA], `╭${sky}╮`, 0);
  rows[R_BGB] = place(rows[R_BGB], "╰────╯", 0);

  const dl = String(Math.round(stats.deals)).padStart(3);
  rows[R_BGA] = place(rows[R_BGA], "╔═DEALS════╗", 20);
  rows[R_BGB] = place(rows[R_BGB], `║ DL:${dl}%  ║`, 20);

  // Desk (rows 7–9, right: 10 wide at x=22)
  rows[R_SP0 + 3] = place(rows[R_SP0 + 3], "╔════════╗", 22);
  rows[R_SP0 + 4] = place(rows[R_SP0 + 4], "║        ║", 22);
  rows[R_SP0 + 5] = place(rows[R_SP0 + 5], "╚════════╝", 22);

  // Floor with coffee
  rows[R_FLOOR] = "─".repeat(CONTENT);
  const cup = stats.energy > 60 ? "[c~]" : stats.energy > 30 ? "[c-]" : "[c_]";
  rows[R_FLOOR] = place(rows[R_FLOOR], cup, CONTENT - 5);
}

function drawHome(rows: string[], frame: number, stats: PetStats): void {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;

  rows[R_SKY] = "─".repeat(CONTENT);

  // Window left (8 wide)
  rows[R_BGA] = place(rows[R_BGA], "╭──────╮", 0);
  const yard = isDay
    ? (frame % 8 < 4 ? "│ ~~~~ │" : "│~~~~~ │")
    : (frame % 8 < 4 ? "│  **  │" : "│ *  * │");
  rows[R_BGB] = place(rows[R_BGB], yard, 0);

  // TV right (10 wide at x=22)
  const tvContent = ["[~~~]", "[~~ ]", "[ ~~]", "[~~~]"][frame % 4] ?? "[~~~]";
  rows[R_BGA] = place(rows[R_BGA], "╔══TV════╗", 22);
  rows[R_BGB] = place(rows[R_BGB], `║${tvContent}   ║`, 22);

  // Couch (rows 6–8, right: 10 wide at x=22)
  rows[R_SP0 + 2] = place(rows[R_SP0 + 2], "╭────────╮", 22);
  rows[R_SP0 + 3] = place(rows[R_SP0 + 3], "│ ≈≈≈≈≈≈ │", 22);
  rows[R_SP0 + 4] = place(rows[R_SP0 + 4], "╰════════╯", 22);

  // Carpet floor (precomputed; placement only varies with stats)
  rows[R_FLOOR] = HOME_CARPET;
  const cup = stats.energy > 60 ? "[c~]" : stats.energy > 30 ? "[c-]" : "[c_]";
  rows[R_FLOOR] = place(rows[R_FLOOR], cup, 9);
}

function drawOutdoors(rows: string[], frame: number, _stats: PetStats): void {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;

  // Sky: dot texture + sun/moon + drifting cloud
  rows[R_SKY] = ". . . . . . . . . . . . . . . .".slice(0, CONTENT);
  rows[R_SKY] = place(rows[R_SKY], isDay ? "[O]" : "[*]", 1);
  const cloudX = 10 + Math.floor((Math.sin(frame * 0.08) * 0.5 + 0.5) * 10);
  rows[R_SKY] = place(rows[R_SKY], frame % 8 < 4 ? "(~~)" : "( ~)", cloudX);

  // Single tree (left, rows 1–2)
  rows[R_BGA] = place(rows[R_BGA], " /|\\", 0);
  rows[R_BGB] = place(rows[R_BGB], " |||", 0);

  // Grass floor (subtle shimmer)
  rows[R_FLOOR] = Array.from({ length: CONTENT }, (_, i) =>
    (i + frame) % 9 === 0 ? "w" : "─"
  ).join("");
}

function drawBackground(rows: string[], env: Environment, frame: number, stats: PetStats): void {
  if (env === "office")    drawOffice(rows, frame, stats);
  else if (env === "home") drawHome(rows, frame, stats);
  else                     drawOutdoors(rows, frame, stats);
}

// ─── fluid activity particles ─────────────────────────────────────────────────
function drawParticles(rows: string[], activity: PetActivity, frame: number): void {
  const sx = SPRITE_X[activity];

  switch (activity) {
    case "sleeping": {
      // z chain rising above sprite — each z climbs one row per 2 frames
      const chars: ["z", "z", "Z"] = ["z", "z", "Z"];
      for (let i = 0; i < 3; i++) {
        const age = (frame + i * 4) % 14;
        if (age < 10) {
          const py = R_DECO - Math.floor(age / 3);
          const px = sx + 3 + i;
          if (py >= 0 && px < CONTENT) rows[py] = place(rows[py], chars[i] ?? "z", px);
        }
      }
      break;
    }

    case "playing": {
      // Arms progressively extend each phase
      const phase = frame % 6;
      if (phase >= 1) {
        rows[R_SP0 + 1] = place(rows[R_SP0 + 1], "\\", Math.max(0, sx - 1));
        rows[R_SP0 + 1] = place(rows[R_SP0 + 1], "/", sx + SPRITE_W);
      }
      if (phase >= 2) {
        rows[R_SP0] = place(rows[R_SP0], "\\", Math.max(0, sx - 2));
        rows[R_SP0] = place(rows[R_SP0], "/", Math.min(CONTENT - 1, sx + SPRITE_W + 1));
      }
      if (phase >= 3) {
        rows[R_SP0] = place(rows[R_SP0], "\\", Math.max(0, sx - 3));
        rows[R_SP0] = place(rows[R_SP0], "/", Math.min(CONTENT - 1, sx + SPRITE_W + 2));
        // Stars burst at peak flex
        rows[R_BGB] = place(rows[R_BGB], "*", Math.max(0, sx - 4));
        rows[R_BGB] = place(rows[R_BGB], "*", Math.min(CONTENT - 1, sx + SPRITE_W + 3));
        rows[R_BGA] = place(rows[R_BGA], "*", Math.max(0, sx - 2));
        rows[R_BGA] = place(rows[R_BGA], "*", Math.min(CONTENT - 1, sx + SPRITE_W + 1));
      }
      break;
    }

    case "working": {
      const smash = frame % 32 >= 26;
      if (smash) {
        const sf = frame % 32 - 26;
        if (sf < 2)      rows[R_DECO] = place(rows[R_DECO], "  !!! SMASH !!!  ", 7);
        else if (sf < 4) { rows[R_BGB] = place(rows[R_BGB], " * B O O M * ", 9); }
        else             rows[R_BGA] = place(rows[R_BGA], " .  .  .  . ", 10);
      } else {
        // 3 staggered $ streams raining from sky through deco row
        const cols = [7, 14, 25] as const;
        for (let i = 0; i < 3; i++) {
          const colX = cols[i] ?? 7;
          for (const off of [0, 9] as const) {
            const age = (frame + i * 6 + off) % 18;
            const py = Math.floor(age / 2);
            if (py <= R_DECO) rows[py] = place(rows[py], "$", colX);
          }
        }
      }
      break;
    }

    case "eating": {
      // Deal memo arcs smoothly from right toward sprite
      const memos: [string, number][] = [["$", 0], ["%", 4]];
      for (const [char, off] of memos) {
        const p = (frame + off) % 8;
        if (p < 6) {
          const endX = sx + SPRITE_W + 1;
          const startX = CONTENT - 3;
          const px = Math.round(startX - (p / 5) * (startX - endX));
          const row = R_SP0 + 2 + (off > 0 ? 1 : 0);
          if (px >= endX && row < R_FLOOR) rows[row] = place(rows[row], char, px);
        }
      }
      break;
    }

    case "praised": {
      // Expanding star burst radiating outward over 5 frames
      const cx = sx + Math.floor(SPRITE_W / 2);
      const phase = frame % 5;
      if (phase === 0) {
        rows[R_DECO] = place(rows[R_DECO], "*", cx);
      } else if (phase === 1) {
        rows[R_DECO] = place(rows[R_DECO], "*", Math.max(0, cx - 2));
        rows[R_DECO] = place(rows[R_DECO], "*", Math.min(CONTENT - 1, cx + 2));
        rows[R_BGB]  = place(rows[R_BGB],  "*", cx);
      } else if (phase === 2) {
        rows[R_DECO] = place(rows[R_DECO], "*", Math.max(0, cx - 4));
        rows[R_DECO] = place(rows[R_DECO], "*", Math.min(CONTENT - 1, cx + 4));
        rows[R_BGB]  = place(rows[R_BGB],  "*", Math.max(0, cx - 2));
        rows[R_BGB]  = place(rows[R_BGB],  "*", Math.min(CONTENT - 1, cx + 2));
        rows[R_BGA]  = place(rows[R_BGA],  "*", cx);
      } else if (phase === 3) {
        rows[R_SKY] = place(rows[R_SKY], "*", Math.max(0, cx - 6));
        rows[R_SKY] = place(rows[R_SKY], "*", cx);
        rows[R_SKY] = place(rows[R_SKY], "*", Math.min(CONTENT - 1, cx + 6));
      }
      // phase 4 = clear
      break;
    }

    case "vibing": {
      // Concentric ~ rings expanding each frame, reset at 5
      const wave = frame % 5;
      if (wave >= 1) {
        if (sx - 1 >= 0)           rows[R_SP0 + 2] = place(rows[R_SP0 + 2], "~", sx - 1);
        rows[R_SP0 + 2] = place(rows[R_SP0 + 2], "~", sx + SPRITE_W);
      }
      if (wave >= 2) {
        if (sx - 2 >= 0)           rows[R_SP0 + 1] = place(rows[R_SP0 + 1], "~", sx - 2);
        rows[R_SP0 + 1] = place(rows[R_SP0 + 1], "~", Math.min(CONTENT - 1, sx + SPRITE_W + 1));
        if (sx - 1 >= 0)           rows[R_DECO] = place(rows[R_DECO], "~", sx - 1);
        rows[R_DECO] = place(rows[R_DECO], "~", Math.min(CONTENT - 1, sx + SPRITE_W));
      }
      if (wave >= 3) {
        if (sx - 3 >= 0)           rows[R_BGB] = place(rows[R_BGB], "~", sx - 3);
        rows[R_BGB] = place(rows[R_BGB], "~", Math.min(CONTENT - 1, sx + SPRITE_W + 2));
      }
      if (wave >= 4) {
        if (sx - 4 >= 0)           rows[R_BGA] = place(rows[R_BGA], "~", sx - 4);
        rows[R_BGA] = place(rows[R_BGA], "~", Math.min(CONTENT - 1, sx + SPRITE_W + 3));
      }
      break;
    }
  }
}

// ─── deco text above sprite ───────────────────────────────────────────────────
function buildDeco(activity: PetActivity, frame: number): string {
  switch (activity) {
    case "sleeping": return ["z  .  .", ".  z  .", ".  .  z", "Z  Z  Z"][frame % 4] ?? "z";
    case "eating":   return Math.floor(frame / 3) % 2 === 0 ? " nom  nom  nom " : " NOM  NOM  NOM ";
    case "playing": {
      const f = frame % 6;
      return f < 2 ? "  G A I N S !  " : f < 4 ? " *FLEX MODE ON*" : " CORPORATE PUMP";
    }
    case "praised":  return frame % 2 === 0 ? "  * * * * * * *" : " * * * * * * * ";
    case "working": {
      if (frame % 32 >= 26) return ""; // smash handled by particles
      const d = ["[............]","[o...........]","[.o..........]","[..o.........]",
                 "[...o........]","[....o.......]","[.....o......]","[......o.....]",
                 "[.......o....]","[........o...]","[.........o..]","[..........o.]",
                 "[...........o]"];
      return d[frame % d.length] ?? "[............]";
    }
    case "vibing":   return ["~ ~ ~ ~ ~ ~ ~"," ~ ~ ~ ~ ~ ~ ","  ~ ~ ~ ~ ~  "][frame % 3] ?? "~";
    default:         return "";
  }
}

// ─── full scene builder ───────────────────────────────────────────────────────
function buildScene(
  activity: PetActivity,
  frame: number,
  stats: PetStats,
  env: Environment,
): string[] {
  const rows: string[] = Array.from({ length: SCENE_ROWS }, () => " ".repeat(CONTENT));

  drawBackground(rows, env, frame, stats);
  drawParticles(rows, activity, frame);

  const deco = buildDeco(activity, frame);
  if (deco) {
    const sx = SPRITE_X[activity];
    const dx = Math.max(0, Math.min(CONTENT - deco.length, sx - Math.floor((deco.length - SPRITE_W) / 2)));
    rows[R_DECO] = place(rows[R_DECO], deco, dx);
  }

  const sprite = buildSprite(activity, frame);
  const sx = SPRITE_X[activity];
  for (let i = 0; i < sprite.length; i++) {
    rows[R_SP0 + i] = place(rows[R_SP0 + i], sprite[i] ?? "", sx);
  }

  return rows;
}

// ─── row colors ───────────────────────────────────────────────────────────────
function rowColor(i: number, activity: PetActivity, frame: number, t: Theme): string {
  if (i >= R_SP0 && i < R_SP0 + 6) {
    if (activity === "sleeping") return t.dim;
    if (activity === "praised")  return t.primaryLight;
    if (activity === "eating")   return t.warning;
    if (activity === "playing")  return frame % 6 >= 3 ? t.primaryLight : t.primary;
    if (activity === "working" && frame % 32 >= 26) return t.error;
    return t.primary;
  }
  if (i === R_DECO) {
    if (activity === "working" && frame % 32 >= 26) return t.error;
    if (activity === "sleeping")  return t.dim;
    if (activity === "praised")   return t.warning;
    if (activity === "eating")    return t.warning;
    if (activity === "playing")   return t.primaryLight;
    return t.primaryLight;
  }
  if (i === R_FLOOR) return t.primaryDim;
  if (i === R_SKY)   return t.dim;
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

// ─── stat bar ─────────────────────────────────────────────────────────────────
function StatBarInner({
  label, value, barColor, labelColor, warnColor,
}: {
  label: string; value: number; barColor: string; labelColor: string; warnColor: string;
}) {
  const filled = Math.round((value / 100) * 14);
  const bar = "█".repeat(filled) + "░".repeat(14 - filled);
  const pct = String(Math.round(value)).padStart(3);
  const isLow = value < 25;
  return (
    <Text>
      <Text color={labelColor}>{pad(label, 6)}</Text>
      <Text color={isLow ? warnColor : barColor}>{bar}</Text>
      <Text color={isLow ? warnColor : labelColor}> {pct}%</Text>
    </Text>
  );
}
const StatBar = memo(StatBarInner);

// ─── component ────────────────────────────────────────────────────────────────
interface PetPanelProps {
  stats: PetStats;
  activity: PetActivity;
  env?: Environment;
  isPaused?: boolean;
}

function PetPanelView({ stats, activity, env = "office", isPaused = false }: PetPanelProps) {
  const t = useTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
  }, [activity, env]);

  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => {
      setFrame((f) => f + 1);
    }, 800);
    return () => clearInterval(id);
  }, [isPaused]);

  const scene = useMemo(
    () => buildScene(activity, frame, stats, env),
    [activity, frame, stats, env],
  );
  const mood = useMemo(() => getPetMood(stats), [stats]);
  const status = useMemo(
    () => pad(`memo ${getStatusMsg(stats, frame)}`, CONTENT),
    [stats, frame],
  );
  const title = fitDisplayText(`DREXLER DEAL DESK [${env}]`, CONTENT);
  const activityLabel = activity !== "idle" ? ` / ${activity}` : "";
  const moodLabel = `mood ${mood}`;
  const fittedMood = activityLabel
    ? fitDisplayText(moodLabel, Math.max(1, CONTENT - displayWidth(activityLabel)))
    : fitDisplayText(moodLabel, CONTENT);
  const fittedActivity = activityLabel && displayWidth(fittedMood) < CONTENT
    ? fitDisplayText(activityLabel, CONTENT - displayWidth(fittedMood))
    : "";

  return (
    <Box
      flexDirection="column"
      width={PET_PANEL_WIDTH}
      flexShrink={0}
      borderStyle="round"
      borderColor={t.primaryDim}
    >
      <Box paddingX={1} justifyContent="center">
        <Text color={t.primary} bold>{title}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        {scene.map((row, i) => (
          <Text key={i} color={rowColor(i, activity, frame, t)}>{row}</Text>
        ))}
      </Box>

      <Box paddingX={1}>
        <Text color={t.primaryDim}>{"─".repeat(CONTENT)}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <StatBar label="happy" value={stats.happiness} barColor={t.primary}      labelColor={t.dim} warnColor={t.error} />
        <StatBar label="hungr" value={stats.hunger}    barColor={t.primaryLight} labelColor={t.dim} warnColor={t.warning} />
        <StatBar label="enrgy" value={stats.energy}    barColor={t.primaryLight} labelColor={t.dim} warnColor={t.warning} />
        <StatBar label="deals" value={stats.deals}     barColor={t.primaryDim}   labelColor={t.dim} warnColor={t.warning} />
      </Box>

      <Box paddingX={1}>
        <Text color={t.primaryDim}>{"─".repeat(CONTENT)}</Text>
      </Box>

      <Box paddingX={1}>
        <Text color={t.dim}>{status}</Text>
      </Box>

      <Box paddingX={1}>
        <Text color={t.dim}>{fittedMood}</Text>
        {fittedActivity && <Text color={t.primaryDim}>{fittedActivity}</Text>}
      </Box>
    </Box>
  );
}

export const PetPanel = memo(PetPanelView);
