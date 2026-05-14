import { Box, Text } from "ink";
import { memo, useEffect, useState } from "react";
import { getPetMood, type PetActivity, type PetStats } from "../../pet/petState.ts";
import { fitDisplayText } from "../graphemes.ts";
import { useTheme } from "../ThemeContext.tsx";
import type { Environment } from "./MascotScene.tsx";
import { pickWorstStat } from "./shared.ts";

export const COMPACT_PET_PANEL_ROWS = 5;
export const TINY_PET_PANEL_ROWS = 1;
export const COMPACT_PET_PANEL_MIN_WIDTH = 48;

const PANEL_BORDER_COLUMNS = 2;
const PANEL_PADDING_COLUMNS = 2;

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
  "hunger.critical": [
    "Feed him. Now.",
    "Pipeline empty. Stomach emptier.",
    "Caloric intake: zero.",
    "Deal intake required. Urgent.",
    "No lunch. Board concerned.",
  ],
  "hunger.low": [
    "Could use a deal snack.",
    "Peckish. Dangerously so.",
    "Running on fumes and spite.",
    "Lunch was conceptual.",
    "Hunger creeping. Bad sign.",
  ],
  "hunger.ok": [
    "Fed. Functional.",
    "Satiated. Marginally.",
    "Nourishment confirmed.",
    "Caloric metrics acceptable.",
    "Pipeline: sufficient.",
  ],
  "hunger.good": [
    "Well fed. Projecting strength.",
    "Deal appetite satisfied.",
    "Lunch closed. Board nods.",
    "Caloric position: strong.",
    "Nutritionally sound.",
  ],
  "hunger.great": [
    "Fully loaded. Ready to close.",
    "Peak caloric window open.",
    "Briefcase well-stocked.",
    "Drexler has eaten. Fear him.",
    "Maximum deal absorption.",
  ],

  "happiness.critical": [
    "Morale: sub-basement.",
    "Joy metrics: catastrophic.",
    "Drexler deeply dissatisfied.",
    "Considering self-restructure.",
    "Send help. Immediately.",
  ],
  "happiness.low": [
    "Confidence is flagging.",
    "Sentiment negative. Act now.",
    "Drexler is not thriving.",
    "Market ungrateful, apparently.",
    "Spirits declining. Alarming.",
  ],
  "happiness.ok": [
    "Maintaining composure.",
    "Cautiously optimistic.",
    "Neutral outlook. For now.",
    "Equilibrium: tenuous.",
    "Tolerable. Barely.",
  ],
  "happiness.good": [
    "Pipeline robust. Spirits up.",
    "Drexler is in the zone.",
    "Good day in the deal room.",
    "Shareholders pleased. Briefly.",
    "Morale: acceptable.",
  ],
  "happiness.great": [
    "Unstoppable. Frankly.",
    "Peak performance window.",
    "Manic energy. Deploy wisely.",
    "Drexler ascendant. Watch out.",
    "Maximum euphoria. Imminent.",
  ],

  "energy.critical": [
    "Running on fumes. Critical.",
    "System depleted. Recharge.",
    "Drexler barely upright.",
    "Energy: dangerous lows.",
    "Rest now. Non-negotiable.",
  ],
  "energy.low": [
    "Coffee required. Urgently.",
    "Flagging slightly. Or a lot.",
    "Energy deficit detected.",
    "Strategic nap advised.",
    "Reserves low. Efficiency shaky.",
  ],
  "energy.ok": [
    "Operational. Barely.",
    "Chugging along.",
    "Energy acceptable. Recheck.",
    "Functional. Not inspired.",
    "Adequate. For now.",
  ],
  "energy.good": [
    "Energized. Alert. Ready.",
    "Ready to close deals.",
    "Drexler is firing well.",
    "Full capacity. Mostly.",
    "Energy surplus confirmed.",
  ],
  "energy.great": [
    "Fully charged. Dangerous.",
    "Drexler is electrified.",
    "Energy max. Scope unlimited.",
    "Running at 110%. Somehow.",
    "Kinetic. Caffeinated.",
  ],

  "deals.critical": [
    "Pipeline: bone dry.",
    "No deals. Board is watching.",
    "Zero live mandates. Shameful.",
    "Origination needed. Now.",
    "Empty pipe. Reputation at risk.",
  ],
  "deals.low": [
    "Pipeline thin. Worrying.",
    "Deal flow: trickling.",
    "Source aggressively.",
    "Activity light. Drexler restless.",
    "Book thin. Posture defensive.",
  ],
  "deals.ok": [
    "Pipeline: moderate.",
    "Deal flow steady. Could improve.",
    "Working the book.",
    "Several irons in the fire.",
    "Deal cadence acceptable.",
  ],
  "deals.good": [
    "Pipeline full. Drexler pleased.",
    "Multiple term sheets live.",
    "Deal machine: operational.",
    "The book is healthy.",
    "Deal flow strong. Board nods.",
  ],
  "deals.great": [
    "Crushing it, frankly.",
    "Overflowing pipeline. Good problem.",
    "Drexler is the deal machine.",
    "Maximum origination achieved.",
    "Board in awe. Secretly.",
  ],
};

function getStatusMsg(stats: PetStats, frame: number): string {
  const entries: [string, number][] = [
    ["hunger", stats.hunger],
    ["happiness", stats.happiness],
    ["energy", stats.energy],
    ["deals", stats.deals],
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

interface CompactPetPanelProps {
  stats: PetStats;
  activity: PetActivity;
  env?: Environment;
  isPaused?: boolean;
  width: number;
}

function CompactPetPanelView({ stats, activity, isPaused = false, width }: CompactPetPanelProps) {
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
    const accent = worstLevel === "critical" || worstLevel === "low" ? t.warning : t.primary;
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
        <Text color={t.primary} bold>
          {fitDisplayText(header, innerWidth)}
        </Text>
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
