import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatTenure,
  getPetMood,
  getPetRank,
  petTenureMs,
  rankLabel,
  type PetActivity,
  type PetStats,
} from "../pet/petState.ts";
import { STARTUP_TIPS } from "../startupTips.ts";
import {
  MascotFrame,
  MASCOT_WIDTH,
  type MascotState,
} from "./MascotFrame.tsx";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import {
  COMPACT_PET_PANEL_MIN_WIDTH,
  CompactPetPanel,
  getPetStatusMessage,
  PetScene,
  PET_SCENE_WIDTH,
  type Environment,
} from "./PetPanel.tsx";
import { useTheme } from "./ThemeContext.tsx";

interface IntroFrame extends MascotState {
  delayMs: number;
  note: IntroBootNote;
}

export const INTRO_STATUS_PREFIX = " ◆ ";
export const INTRO_BOOT_NOTES = [
  "Briefcase boot",
  "Deal tape live",
  "Covenants OK",
  "Risk marked",
  "Capital set",
  "Fees captured",
  "Board notified",
  "Final audit",
  "Bid armed",
  "Drexler online",
] as const;

type IntroBootNote = (typeof INTRO_BOOT_NOTES)[number];

const INTRO_FRAMES: IntroFrame[] = [
  {
    walls: "dim",
    brows: "hidden",
    eyes: "hidden",
    showLock: true,
    dollars: "hidden",
    delayMs: 520,
    note: INTRO_BOOT_NOTES[0],
  },
  {
    walls: "on",
    brows: "raised",
    eyes: "hidden",
    showLock: true,
    dollars: "hidden",
    delayMs: 520,
    note: INTRO_BOOT_NOTES[1],
  },
  {
    walls: "on",
    brows: "raised",
    eyes: "open",
    showLock: true,
    dollars: "hidden",
    delayMs: 560,
    note: INTRO_BOOT_NOTES[2],
  },
  {
    walls: "on",
    brows: "flat",
    eyes: "closed",
    showLock: true,
    dollars: "dim",
    delayMs: 420,
    note: INTRO_BOOT_NOTES[3],
  },
  {
    walls: "on",
    brows: "focused",
    eyes: "open",
    showLock: true,
    dollars: "dim",
    delayMs: 520,
    note: INTRO_BOOT_NOTES[4],
  },
  {
    walls: "on",
    brows: "normal",
    eyes: "open",
    showLock: true,
    dollars: "on",
    delayMs: 620,
    note: INTRO_BOOT_NOTES[5],
  },
  {
    walls: "on",
    brows: "flat",
    eyes: "closed",
    showLock: true,
    dollars: "on",
    delayMs: 360,
    note: INTRO_BOOT_NOTES[6],
  },
  {
    walls: "on",
    brows: "focused",
    eyes: "open",
    showLock: true,
    dollars: "dim",
    delayMs: 440,
    note: INTRO_BOOT_NOTES[7],
  },
  {
    walls: "on",
    brows: "raised",
    eyes: "open",
    showLock: true,
    dollars: "on",
    delayMs: 520,
    note: INTRO_BOOT_NOTES[8],
  },
  {
    walls: "on",
    brows: "normal",
    eyes: "open",
    showLock: true,
    dollars: "on",
    delayMs: 1200,
    note: INTRO_BOOT_NOTES[9],
  },
];

const COMPACT_INTRO_NOTES = ["Booting", "Scanning", "Online"];
const COMPACT_INTRO_DELAY_MS = 850;
const SETTLE_HOLD_MS = 1200;
const FRAME_CHROME_WIDTH = 4;
const GUTTER_WIDTH = 4;
const SPLIT_DIVIDER_WIDTH = 3;
const SPLIT_DIVIDER_HEIGHT = 10;
const SPLIT_DIVIDER_ROWS: number[] = Array.from(
  { length: SPLIT_DIVIDER_HEIGHT },
  (_, i) => i,
);
const BOOT_BAR_WIDTH = MASCOT_WIDTH - 1;

// Width breakpoints (terminal columns).
const TINY_BREAKPOINT = 21;
const NARROW_BREAKPOINT = 24;
const COMPACT_BREAKPOINT = 72;
const WIDE_BREAKPOINT = 112;

// Inner-panel sizing floors / glue.
const MIN_DASHBOARD_WIDTH = 28;
const MIN_INNER_WIDTH = 24;
const MIN_COPY_WIDTH = 18;
const MIN_RIGHT_COLUMN_WIDTH = 20;
const MIN_MOOD_PANEL_WIDTH = 18;
const MAX_MOOD_PANEL_WIDTH = 44;
const RIGHT_COLUMN_INSET = 1;
const RIGHT_COLUMN_PAD_RIGHT = 1;
const LEFT_PANEL_MIN_COPY = 24;
const PET_STATS_MIN_WIDTH = 24;
const PET_STATS_MAX_WIDTH = 58;
const PET_SPLIT_DIVIDER_HEIGHT = 12;
const PET_SPLIT_DIVIDER_ROWS: number[] = Array.from(
  { length: PET_SPLIT_DIVIDER_HEIGHT },
  (_, i) => i,
);

export type MascotLayoutMode = "tiny" | "compact" | "stacked" | "split";

export interface MascotPanelBox {
  width: number;
  inset: number;
}

export interface MascotLayout {
  mode: MascotLayoutMode;
  available: number;
  innerWidth: number;
  leftPanel: MascotPanelBox;
  rightColumn: MascotPanelBox;
  rightChildWidth: number;
  copy: MascotPanelBox;
  mood: MascotPanelBox;
  tips: MascotPanelBox;
  dealDesk: MascotPanelBox;
}

export function computeMascotLayout(width: number): MascotLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  if (safeWidth < TINY_BREAKPOINT) {
    const w = safeWidth;
    return {
      mode: "tiny",
      available: w,
      innerWidth: w,
      leftPanel: { width: w, inset: 0 },
      rightColumn: { width: 0, inset: 0 },
      rightChildWidth: 0,
      copy: { width: w, inset: 0 },
      mood: { width: w, inset: 0 },
      tips: { width: w, inset: 0 },
      dealDesk: { width: w, inset: 0 },
    };
  }
  if (safeWidth < COMPACT_BREAKPOINT) {
    const w = Math.max(1, safeWidth - 1);
    return {
      mode: "compact",
      available: w,
      innerWidth: w,
      leftPanel: { width: w, inset: 1 },
      rightColumn: { width: 0, inset: 0 },
      rightChildWidth: 0,
      copy: { width: w, inset: 0 },
      mood: { width: w, inset: 0 },
      tips: { width: w, inset: 0 },
      dealDesk: { width: w, inset: 0 },
    };
  }
  const available = Math.max(MIN_DASHBOARD_WIDTH, safeWidth);
  const innerWidth = Math.max(MIN_INNER_WIDTH, available - FRAME_CHROME_WIDTH);
  if (safeWidth < WIDE_BREAKPOINT) {
    return {
      mode: "stacked",
      available,
      innerWidth,
      leftPanel: { width: innerWidth, inset: 0 },
      rightColumn: { width: 0, inset: 0 },
      rightChildWidth: innerWidth,
      copy: { width: innerWidth, inset: 0 },
      mood: { width: innerWidth, inset: 0 },
      tips: { width: innerWidth, inset: 0 },
      dealDesk: { width: innerWidth, inset: 0 },
    };
  }
  const leftPanelWidth = Math.max(
    MASCOT_WIDTH + GUTTER_WIDTH + LEFT_PANEL_MIN_COPY,
    Math.floor((innerWidth - SPLIT_DIVIDER_WIDTH) / 2),
  );
  const rightColumnWidth = Math.max(
    MIN_RIGHT_COLUMN_WIDTH,
    innerWidth - leftPanelWidth - SPLIT_DIVIDER_WIDTH,
  );
  const rightInner = Math.max(1, rightColumnWidth - RIGHT_COLUMN_PAD_RIGHT);
  const rightChildWidth = Math.max(1, rightInner - RIGHT_COLUMN_INSET);
  const copyWidth = Math.max(
    MIN_COPY_WIDTH,
    leftPanelWidth - MASCOT_WIDTH - GUTTER_WIDTH - 1,
  );
  return {
    mode: "split",
    available,
    innerWidth,
    leftPanel: { width: leftPanelWidth, inset: 0 },
    rightColumn: { width: rightColumnWidth, inset: 0 },
    rightChildWidth,
    copy: { width: copyWidth, inset: 0 },
    mood: { width: copyWidth, inset: 0 },
    tips: { width: rightChildWidth, inset: RIGHT_COLUMN_INSET },
    dealDesk: { width: rightChildWidth, inset: RIGHT_COLUMN_INSET },
  };
}

interface IntroProps {
  greeting: string;
}

interface MascotDashboardProps {
  greeting: string;
  width: number;
  mood?: string;
  mode?: "normal" | "pet";
  petStats?: PetStats;
  petActivity?: PetActivity;
  petEnv?: Environment;
  petPaused?: boolean;
  bootProgress?: number;
  state?: MascotState;
  bar?: string;
  barColor?: string;
  mascotStatus?: string;
  dealDesk?: (width: number) => ReactNode;
}

function introBootBar(frameIdx: number, total: number): string {
  const active = Math.max(
    1,
    Math.ceil(((frameIdx + 1) / total) * BOOT_BAR_WIDTH),
  );
  return " " + "▰".repeat(active) + "▱".repeat(BOOT_BAR_WIDTH - active);
}

function introBootProgress(frameIdx: number, total: number): number {
  return Math.max(0, Math.min(1, (frameIdx + 1) / total));
}

function gaugeBar(progress: number, width: number): string {
  const safeWidth = Math.max(1, width);
  const filled = Math.max(
    0,
    Math.min(safeWidth, Math.round(progress * safeWidth)),
  );
  return `${"█".repeat(filled)}${"░".repeat(safeWidth - filled)}`;
}

function titledPanelBottom(width: number): string {
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function fixedDisplayRows(
  input: string,
  width: number,
  rowCount: number,
): string[] {
  const safeWidth = Math.max(1, width);
  const rows: string[] = [];
  const words = input.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let cursor = 0;

  while (rows.length < rowCount && cursor < words.length) {
    const remaining = words.slice(cursor).join(" ");
    if (rows.length === rowCount - 1 || displayWidth(remaining) <= safeWidth) {
      rows.push(fitDisplayText(remaining, safeWidth));
      cursor = words.length;
      break;
    }

    let row = words[cursor] ?? "";
    cursor += 1;
    if (displayWidth(row) > safeWidth) {
      rows.push(fitDisplayText(row, safeWidth));
      continue;
    }

    while (cursor < words.length) {
      const next = words[cursor] ?? "";
      const candidate = `${row} ${next}`;
      if (displayWidth(candidate) > safeWidth) break;
      row = candidate;
      cursor += 1;
    }
    rows.push(row);
  }

  while (rows.length < rowCount) rows.push("");
  return rows;
}

type IntroColorPhase = "early" | "middle" | "late";

function introTotalFrames(width: number): number {
  return width < COMPACT_BREAKPOINT
    ? COMPACT_INTRO_NOTES.length
    : INTRO_FRAMES.length;
}

function introFrameDelayMs(frameIdx: number, width: number): number {
  if (width < COMPACT_BREAKPOINT) return COMPACT_INTRO_DELAY_MS;
  return (
    INTRO_FRAMES[frameIdx] ?? INTRO_FRAMES[INTRO_FRAMES.length - 1]!
  ).delayMs;
}

function introColorPhase(frameIdx: number, total: number): IntroColorPhase {
  if (frameIdx < total / 3) return "early";
  if (frameIdx < (total * 2) / 3) return "middle";
  return "late";
}

export function introPhaseColor(
  phase: IntroColorPhase,
  colors: { error: string; warning: string; primaryLight: string },
): string {
  return phase === "early"
    ? colors.error
    : phase === "middle"
    ? colors.warning
    : colors.primaryLight;
}

function introSnapshot(frameIdx: number, width: number) {
  const compact = width < COMPACT_BREAKPOINT;
  const total = introTotalFrames(width);
  const boundedFrameIdx = Math.min(frameIdx, total - 1);
  const state =
    INTRO_FRAMES[boundedFrameIdx] ?? INTRO_FRAMES[INTRO_FRAMES.length - 1]!;
  const note = compact
    ? COMPACT_INTRO_NOTES[
        Math.min(boundedFrameIdx, COMPACT_INTRO_NOTES.length - 1)
      ]!
    : state.note;
  return {
    bar: introBootBar(boundedFrameIdx, total),
    colorPhase: introColorPhase(frameIdx, total),
    frameIdx: boundedFrameIdx,
    note,
    progress: introBootProgress(boundedFrameIdx, total),
    state,
    status: `${INTRO_STATUS_PREFIX}${note}`,
    total,
  };
}

export function useIntroAnimation(
  width: number,
  active: boolean,
  onComplete?: () => void,
) {
  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrameIdx(0);
      return;
    }

    const total = introTotalFrames(width);
    if (frameIdx >= total - 1) {
      if (!onComplete) return;
      const handle = setTimeout(onComplete, SETTLE_HOLD_MS);
      return () => clearTimeout(handle);
    }

    const handle = setTimeout(() => {
      setFrameIdx((idx) => Math.min(idx + 1, total - 1));
    }, introFrameDelayMs(frameIdx, width));
    return () => clearTimeout(handle);
  }, [active, frameIdx, onComplete, width]);

  return useMemo(() => introSnapshot(frameIdx, width), [frameIdx, width]);
}

function TipsPanel({ width }: { width: number }) {
  const t = useTheme();
  const textWidth = Math.max(1, width);
  const innerWidth = Math.max(1, textWidth - 4);
  const title = "Tips";
  const titlePrefix = "╭─ ";
  const titleSuffix = " ";
  const titleRule = "─".repeat(
    Math.max(
      0,
      textWidth -
        displayWidth(titlePrefix) -
        displayWidth(title) -
        displayWidth(titleSuffix) -
        displayWidth("╮"),
    ),
  );
  return (
    <Box flexDirection="column" width={textWidth}>
      <Text color={t.primary}>
        {titlePrefix}
        <Text bold color={t.primaryLight}>{title}</Text>
        {titleSuffix}
        {titleRule}
        ╮
      </Text>
      {STARTUP_TIPS.map((tip, idx) => {
        const label = `${idx + 1}. `;
        const tipWidth = Math.max(1, innerWidth - displayWidth(label));
        const clippedTip = fitDisplayText(tip, tipWidth);
        const content = `${label}${clippedTip}`;
        return (
          <Text key={tip}>
            <Text color={t.primary}>│ </Text>
            <Text color={t.primaryLight}>{label}</Text>
            <Text color={t.dim}>{clippedTip}</Text>
            <Text color={t.primary}>
              {" ".repeat(Math.max(0, innerWidth - displayWidth(content)))} │
            </Text>
          </Text>
        );
      })}
      <Text color={t.primary}>{titledPanelBottom(textWidth)}</Text>
    </Box>
  );
}

type MoodTone = "error" | "primaryLight" | "warning";

interface MoodPosture {
  badge: string;
  detail: string;
  tone: MoodTone;
}

const NAMED_MOOD_POSTURES: Record<string, readonly MoodPosture[]> = {
  angry: [
    {
      badge: "HOSTILE TENDER",
      detail: "board patience: vaporized",
      tone: "error",
    },
    {
      badge: "REDLINE FEVER",
      detail: "counsel posture: braced",
      tone: "error",
    },
    {
      badge: "FEE HAWK",
      detail: "intern confidence: first pass only",
      tone: "warning",
    },
  ],
  exhausted: [
    {
      badge: "COFFEE DEBT",
      detail: "intern confidence: ceremonial",
      tone: "warning",
    },
    {
      badge: "QUORUM NAPPING",
      detail: "board patience: on fumes",
      tone: "primaryLight",
    },
    {
      badge: "LATE CLOSE",
      detail: "risk posture: blinking slowly",
      tone: "warning",
    },
  ],
  generous: [
    {
      badge: "FEE HOLIDAY",
      detail: "board patience: briefly subsidized",
      tone: "primaryLight",
    },
    {
      badge: "SOFT CLOSE",
      detail: "risk posture: laminated optimism",
      tone: "primaryLight",
    },
    {
      badge: "COUNSEL NEAR",
      detail: "intern confidence: first pass only",
      tone: "error",
    },
  ],
  manic: [
    {
      badge: "DEAL SPIRAL",
      detail: "committee pulse: overclocked",
      tone: "warning",
    },
    {
      badge: "CALENDAR HEAT",
      detail: "board patience: rescheduled twice",
      tone: "warning",
    },
    {
      badge: "TERM SHEET TORNADO",
      detail: "risk posture: wearing a helmet",
      tone: "error",
    },
  ],
  paranoid: [
    {
      badge: "RISK BUNKER",
      detail: "board patience: subpoena-ready",
      tone: "error",
    },
    {
      badge: "BURNER ROOM",
      detail: "counsel posture: whispering",
      tone: "warning",
    },
    {
      badge: "BOARD LOCKED",
      detail: "committee pulse: encrypted",
      tone: "error",
    },
  ],
  ruthless: [
    {
      badge: "FEE HAWK",
      detail: "risk posture: smiling through counsel",
      tone: "primaryLight",
    },
    {
      badge: "MANDATE CLAW",
      detail: "board patience: non-appealable",
      tone: "warning",
    },
    {
      badge: "COVENANT TEETH",
      detail: "intern confidence: collateralized",
      tone: "error",
    },
  ],
  victorious: [
    {
      badge: "TAPE PARADE",
      detail: "intern confidence: legally inadvisable",
      tone: "warning",
    },
    {
      badge: "BELL RUNG",
      detail: "board patience: temporarily restored",
      tone: "primaryLight",
    },
    {
      badge: "TROPHY FILING",
      detail: "counsel posture: drafting confetti",
      tone: "warning",
    },
  ],
};

const FALLBACK_MOOD_POSTURES: readonly MoodPosture[] = [
  {
    badge: "CALENDAR HEAT",
    detail: "board patience: rescheduled twice",
    tone: "warning",
  },
  {
    badge: "SOFT CLOSE",
    detail: "risk posture: laminated optimism",
    tone: "primaryLight",
  },
  {
    badge: "COUNSEL NEAR",
    detail: "intern confidence: first pass only",
    tone: "error",
  },
];

function hashText(input: string): number {
  return Array.from(input).reduce(
    (sum, char) => sum + (char.codePointAt(0) ?? 0),
    0,
  );
}

function moodPosture(mood: string, seed: number): MoodPosture {
  const key = mood.trim().toLowerCase();
  const pool = NAMED_MOOD_POSTURES[key] ?? FALLBACK_MOOD_POSTURES;
  return pool[Math.abs(hashText(key) + seed) % pool.length] ?? pool[0]!;
}

function moodToneColor(t: ReturnType<typeof useTheme>, tone: MoodTone): string {
  return tone === "error"
    ? t.error
    : tone === "warning"
    ? t.warning
    : t.primaryLight;
}

function bootPostureDetail(progress: number): string {
  if (progress < 0.25) return "committee pulse: suspicious";
  if (progress < 0.5) return "fee antenna: extending";
  if (progress < 0.75) return "counsel posture: stiffening";
  return "board patience: nearly loaded";
}

function MoodReadout({
  mood,
  progress = 1,
  progressColor,
  width,
}: {
  mood?: string;
  progress?: number;
  progressColor?: string;
  width: number;
}) {
  const t = useTheme();
  if (!mood) return null;

  const postureSeed = useMemo(() => Math.floor(Math.random() * 1_000_000_000), []);
  const boundedProgress = Math.max(0, Math.min(1, progress));
  const normalizedMood = mood.toUpperCase();
  const posture = moodPosture(mood, postureSeed);
  const postureColor = moodToneColor(t, posture.tone);
  const moodPrefix = "";
  const pct = `${Math.round(boundedProgress * 100)
    .toString()
    .padStart(3, " ")}%`;

  if (width < NARROW_BREAKPOINT) {
    const tinyText =
      boundedProgress >= 1
        ? `${normalizedMood} / ${posture.badge}`
        : pct;
    return (
      <Box width={Math.max(1, width)}>
        <Text
          color={
            boundedProgress >= 1 ? postureColor : progressColor ?? t.primaryLight
          }
        >
          {fitDisplayText(tinyText, Math.max(1, width))}
        </Text>
      </Box>
    );
  }

  const panelWidth = Math.max(MIN_MOOD_PANEL_WIDTH, Math.min(MAX_MOOD_PANEL_WIDTH, width));
  const innerWidth = Math.max(1, panelWidth - 4);
  const title = "Mood";
  const isSettled = boundedProgress >= 1;
  const topPrefix = "╭─ ";
  const topSuffix = " ";
  const topRule = "─".repeat(
    Math.max(
      0,
      panelWidth -
        displayWidth(topPrefix) -
        displayWidth(title) -
        displayWidth(topSuffix) -
        displayWidth("╮"),
    ),
  );
  const settledSuffix = ` / ${posture.badge}`;
  const compactSettledSuffix = ` / ${fitDisplayText(posture.badge, 8)}`;
  const activeSettledSuffix =
    displayWidth(moodPrefix) +
      displayWidth(normalizedMood) +
      displayWidth(settledSuffix) <=
    innerWidth
      ? settledSuffix
      : compactSettledSuffix;
  const moodTextWidth = Math.max(
    1,
    innerWidth -
      displayWidth(moodPrefix) -
      (isSettled ? displayWidth(activeSettledSuffix) : 0),
  );
  const moodText = fitDisplayText(normalizedMood, moodTextWidth);
  const settledContent = `${moodPrefix}${moodText}${activeSettledSuffix}`;
  const detailText = fitDisplayText(
    isSettled ? posture.detail : bootPostureDetail(boundedProgress),
    innerWidth,
  );
  const pctWidth = displayWidth(pct);
  const barWidth = Math.max(4, innerWidth - pctWidth - 4);
  const bar = gaugeBar(boundedProgress, barWidth);
  const gaugeContent = `[${bar}] ${pct}`;

  return (
    <Box flexDirection="column" width={panelWidth}>
      <Text color={t.primaryDim}>
        {topPrefix}
        <Text bold color={t.warning}>
          {title}
        </Text>
        {topSuffix}
        {topRule}
        ╮
      </Text>
      {isSettled ? (
        <>
          <Text>
            <Text color={t.primaryDim}>│ </Text>
            <Text bold color={postureColor}>
              {moodText}
            </Text>
            <Text color={t.primaryDim}>{activeSettledSuffix}</Text>
            <Text color={t.primaryDim}>
              {" ".repeat(
                Math.max(0, innerWidth - displayWidth(settledContent)),
              )}
              {" │"}
            </Text>
          </Text>
          <Text>
            <Text color={t.primaryDim}>│ </Text>
            <Text color={t.dim}>{detailText}</Text>
            <Text color={t.primaryDim}>
              {" ".repeat(Math.max(0, innerWidth - displayWidth(detailText)))} │
            </Text>
          </Text>
        </>
      ) : (
        <>
          <Text>
            <Text color={t.primaryDim}>│ </Text>
            <Text color={t.primaryDim}>[</Text>
            <Text color={progressColor ?? t.primaryLight}>{bar}</Text>
            <Text color={t.primaryDim}>] </Text>
            <Text color={t.primaryLight}>{pct}</Text>
            <Text color={t.primaryDim}>
              {" ".repeat(Math.max(0, innerWidth - displayWidth(gaugeContent)))} │
            </Text>
          </Text>
          <Text>
            <Text color={t.primaryDim}>│ </Text>
            <Text color={t.dim}>{detailText}</Text>
            <Text color={t.primaryDim}>
              {" ".repeat(Math.max(0, innerWidth - displayWidth(detailText)))} │
            </Text>
          </Text>
        </>
      )}
      <Text color={t.primaryDim}>{titledPanelBottom(panelWidth)}</Text>
    </Box>
  );
}

function padDisplayText(input: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const fitted = fitDisplayText(input, safeWidth);
  return `${fitted}${" ".repeat(Math.max(0, safeWidth - displayWidth(fitted)))}`;
}

function PetSceneReadout({
  stats,
  activity,
  env,
  isPaused,
  width,
}: {
  stats: PetStats;
  activity: PetActivity;
  env: Environment;
  isPaused: boolean;
  width: number;
}) {
  const t = useTheme();
  const safeWidth = Math.max(1, Math.floor(width));

  if (safeWidth < PET_SCENE_WIDTH) {
    return (
      <CompactPetPanel
        stats={stats}
        activity={activity}
        env={env}
        isPaused={isPaused}
        width={safeWidth}
      />
    );
  }

  return (
    <Box flexDirection="column" width={safeWidth} alignItems="center">
      <Text bold color={t.primaryLight}>
        {fitDisplayText(`Drexler Pet Desk [${env}]`, safeWidth)}
      </Text>
      <PetScene
        stats={stats}
        activity={activity}
        env={env}
        isPaused={isPaused}
      />
    </Box>
  );
}

function PetStatsBodyLine({
  text,
  width,
  color,
}: {
  text: string;
  width: number;
  color: string;
}) {
  const t = useTheme();
  const innerWidth = Math.max(1, width - 4);
  const content = padDisplayText(text, innerWidth);
  return (
    <Text>
      <Text color={t.primary}>│ </Text>
      <Text color={color}>{content}</Text>
      <Text color={t.primary}> │</Text>
    </Text>
  );
}

function PetDashboardStatBar({
  label,
  value,
  width,
}: {
  label: string;
  value: number;
  width: number;
}) {
  const t = useTheme();
  const innerWidth = Math.max(1, width - 4);
  const pct = `${Math.round(value).toString().padStart(3)}%`;
  const labelText = padDisplayText(label, Math.min(7, innerWidth));
  const prefixWidth = displayWidth(labelText);
  const barWidth = Math.max(
    1,
    innerWidth - prefixWidth - displayWidth(pct) - 2,
  );
  const bounded = Math.max(0, Math.min(100, value));
  const filled = Math.max(
    0,
    Math.min(barWidth, Math.round((bounded / 100) * barWidth)),
  );
  const empty = Math.max(0, barWidth - filled);
  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  const used = prefixWidth + 1 + displayWidth(bar) + 1 + displayWidth(pct);
  const isLow = value < 25;
  const barColor = isLow
    ? t.warning
    : label === "deals"
      ? t.primaryDim
      : t.primaryLight;

  if (innerWidth < 14) {
    return (
      <PetStatsBodyLine
        text={`${label} ${pct}`}
        width={width}
        color={isLow ? t.warning : t.text}
      />
    );
  }

  return (
    <Text>
      <Text color={t.primary}>│ </Text>
      <Text color={t.dim}>{labelText} </Text>
      <Text color={barColor}>{bar}</Text>
      <Text color={isLow ? t.warning : t.dim}> {pct}</Text>
      <Text color={t.primary}>
        {" ".repeat(Math.max(0, innerWidth - used))} │
      </Text>
    </Text>
  );
}

function PetStatsReadout({
  stats,
  activity,
  env,
  width,
}: {
  stats: PetStats;
  activity: PetActivity;
  env: Environment;
  width: number;
}) {
  const t = useTheme();
  const panelWidth = Math.max(
    1,
    Math.min(PET_STATS_MAX_WIDTH, Math.floor(width)),
  );
  const innerWidth = Math.max(1, panelWidth - 4);
  const mood = getPetMood(stats);
  const rank = rankLabel(getPetRank(stats));
  const name = stats.name ?? "Drexler";
  const activityLabel = activity === "idle" ? "idle" : activity;
  const title = "Pet Stats";
  const topPrefix = "╭─ ";
  const topSuffix = " ";
  const topRule = "─".repeat(
    Math.max(
      0,
      panelWidth -
        displayWidth(topPrefix) -
        displayWidth(title) -
        displayWidth(topSuffix) -
        displayWidth("╮"),
    ),
  );
  const memo = `memo ${getPetStatusMessage(stats, 0)}`;

  if (panelWidth < PET_STATS_MIN_WIDTH) {
    return (
      <Box flexDirection="column" width={panelWidth}>
        <Text bold color={t.primaryLight}>
          {fitDisplayText("Pet Stats", panelWidth)}
        </Text>
        <Text color={t.text}>
          {fitDisplayText(`${name} / ${rank}`, panelWidth)}
        </Text>
        <Text color={t.dim}>
          {fitDisplayText(`${mood} / ${activityLabel}`, panelWidth)}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={panelWidth}>
      <Text color={t.primary}>
        {topPrefix}
        <Text bold color={t.primaryLight}>{title}</Text>
        {topSuffix}
        {topRule}
        ╮
      </Text>
      <PetStatsBodyLine
        text={`name ${name}`}
        width={panelWidth}
        color={t.text}
      />
      <PetStatsBodyLine
        text={`rank ${rank} · mood ${mood}`}
        width={panelWidth}
        color={t.primaryLight}
      />
      <PetStatsBodyLine
        text={`activity ${activityLabel} · env ${env}`}
        width={panelWidth}
        color={t.dim}
      />
      <PetStatsBodyLine
        text={`tenure ${formatTenure(petTenureMs(stats))}`}
        width={panelWidth}
        color={t.dim}
      />
      <PetStatsBodyLine
        text={"─".repeat(innerWidth)}
        width={panelWidth}
        color={t.primaryDim}
      />
      <PetDashboardStatBar
        label="happy"
        value={stats.happiness}
        width={panelWidth}
      />
      <PetDashboardStatBar
        label="hunger"
        value={stats.hunger}
        width={panelWidth}
      />
      <PetDashboardStatBar
        label="energy"
        value={stats.energy}
        width={panelWidth}
      />
      <PetDashboardStatBar
        label="deals"
        value={stats.deals}
        width={panelWidth}
      />
      <PetStatsBodyLine
        text={memo}
        width={panelWidth}
        color={t.dim}
      />
      <Text color={t.primary}>{titledPanelBottom(panelWidth)}</Text>
    </Box>
  );
}

function PetDashboard({
  layout,
  stats,
  activity,
  env,
  isPaused,
}: {
  layout: MascotLayout;
  stats: PetStats;
  activity: PetActivity;
  env: Environment;
  isPaused: boolean;
}) {
  const t = useTheme();
  const sideBySide = layout.mode === "split";

  if (layout.mode === "tiny" || layout.mode === "compact") {
    return (
      <Box
        marginLeft={layout.leftPanel.inset}
        width={layout.available}
        flexDirection="column"
      >
        <CompactPetPanel
          stats={stats}
          activity={activity}
          env={env}
          isPaused={isPaused}
          width={Math.max(1, layout.available)}
        />
      </Box>
    );
  }

  return (
    <Box width={layout.available}>
      <Box
        width={layout.available}
        borderStyle="round"
        borderColor={t.primary}
        paddingX={1}
        flexDirection={sideBySide ? "row" : "column"}
        alignItems={sideBySide ? "flex-start" : "center"}
      >
        <Box
          flexDirection="column"
          width={layout.leftPanel.width}
          alignItems="center"
        >
          <PetSceneReadout
            stats={stats}
            activity={activity}
            env={env}
            isPaused={isPaused}
            width={layout.leftPanel.width}
          />
        </Box>
        {sideBySide ? (
          <>
            <Box
              flexDirection="column"
              width={SPLIT_DIVIDER_WIDTH}
              flexShrink={0}
            >
              {PET_SPLIT_DIVIDER_ROWS.map((idx) => (
                <Text key={idx} color={t.primaryDim}>
                  {" │ "}
                </Text>
              ))}
            </Box>
            <Box
              flexDirection="column"
              width={layout.rightColumn.width}
              paddingRight={RIGHT_COLUMN_PAD_RIGHT}
            >
              <Box marginLeft={layout.dealDesk.inset}>
                <PetStatsReadout
                  stats={stats}
                  activity={activity}
                  env={env}
                  width={Math.min(PET_STATS_MAX_WIDTH, layout.dealDesk.width)}
                />
              </Box>
            </Box>
          </>
        ) : (
          <Box marginTop={1} width={layout.tips.width} alignItems="center">
            <PetStatsReadout
              stats={stats}
              activity={activity}
              env={env}
              width={Math.max(COMPACT_PET_PANEL_MIN_WIDTH, layout.tips.width)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function MascotDashboard({
  greeting,
  width,
  mood,
  mode = "normal",
  petStats,
  petActivity = "idle",
  petEnv = "office",
  petPaused = false,
  bootProgress = 1,
  state = INTRO_FRAMES[INTRO_FRAMES.length - 1]!,
  bar = introBootBar(INTRO_FRAMES.length - 1, INTRO_FRAMES.length),
  barColor,
  mascotStatus = `${INTRO_STATUS_PREFIX}${INTRO_BOOT_NOTES[INTRO_BOOT_NOTES.length - 1]}`,
  dealDesk,
}: MascotDashboardProps) {
  const t = useTheme();
  const resolvedBarColor = barColor ?? t.primaryLight;
  const layout = computeMascotLayout(width);
  const sideBySide = layout.mode === "split";
  const wideGreetingRows = sideBySide
    ? fixedDisplayRows(greeting, layout.copy.width, 2)
    : [];

  if (mode === "pet" && petStats) {
    return (
      <PetDashboard
        layout={layout}
        stats={petStats}
        activity={petActivity}
        env={petEnv}
        isPaused={petPaused}
      />
    );
  }

  if (layout.mode === "tiny") {
    return (
      <Box width={layout.available} flexDirection="column">
        <Text color={resolvedBarColor}>{mascotStatus}</Text>
        <Text bold color={t.primaryLight}>
          Drexler™
        </Text>
        <Text color={t.primaryLight}>{greeting}</Text>
        <Box marginTop={1}>
          <MoodReadout
            mood={mood}
            progress={bootProgress}
            progressColor={resolvedBarColor}
            width={layout.mood.width}
          />
        </Box>
        {dealDesk ? (
          <Box marginTop={1}>{dealDesk(layout.dealDesk.width)}</Box>
        ) : null}
      </Box>
    );
  }

  if (layout.mode === "compact") {
    return (
      <Box
        marginLeft={layout.leftPanel.inset}
        width={layout.available}
        flexDirection="column"
      >
        <Text color={resolvedBarColor}>{bar}</Text>
        <Text color={resolvedBarColor}>{mascotStatus}</Text>
        <Text bold color={t.primaryLight}>
          Drexler International™
        </Text>
        <Text color={t.primaryLight}>{greeting}</Text>
        <Box marginTop={1}>
          <MoodReadout
            mood={mood}
            progress={bootProgress}
            progressColor={resolvedBarColor}
            width={layout.mood.width}
          />
        </Box>
        {dealDesk ? (
          <Box marginTop={1}>{dealDesk(layout.dealDesk.width)}</Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box width={layout.available}>
      <Box
        width={layout.available}
        borderStyle="round"
        borderColor={t.primary}
        paddingX={1}
        flexDirection={sideBySide ? "row" : "column"}
        alignItems={sideBySide ? "flex-start" : "center"}
      >
        <Box
          flexDirection={sideBySide ? "row" : "column"}
          width={layout.leftPanel.width}
        >
          <Box
            width={MASCOT_WIDTH}
            flexShrink={0}
            flexDirection="column"
            marginRight={sideBySide ? GUTTER_WIDTH : 0}
          >
            <MascotFrame {...state} />
            <Text color={resolvedBarColor}>{bar}</Text>
            <Text color={resolvedBarColor}>{mascotStatus}</Text>
          </Box>
          <Box
            flexDirection="column"
            justifyContent="center"
            width={layout.copy.width}
            marginTop={sideBySide ? 1 : 0}
          >
            <Text bold color={t.primaryLight}>
              Drexler International™
            </Text>
            <Box height={1} />
            {sideBySide ? (
              wideGreetingRows.map((row, idx) => (
                <Text key={idx} color={t.primaryLight}>
                  {row || " "}
                </Text>
              ))
            ) : (
              <Text color={t.primaryLight}>{greeting}</Text>
            )}
            <Box height={1} />
            <MoodReadout
              mood={mood}
              progress={bootProgress}
              progressColor={resolvedBarColor}
              width={layout.mood.width}
            />
          </Box>
        </Box>
        {sideBySide ? (
          <>
            <Box flexDirection="column" width={SPLIT_DIVIDER_WIDTH} flexShrink={0}>
              {SPLIT_DIVIDER_ROWS.map((idx) => (
                <Text key={idx} color={t.primaryDim}>
                  {" │ "}
                </Text>
              ))}
            </Box>
            <Box
              flexDirection="column"
              width={layout.rightColumn.width}
              paddingRight={RIGHT_COLUMN_PAD_RIGHT}
            >
              <Box marginLeft={layout.tips.inset}>
                <TipsPanel width={layout.tips.width} />
              </Box>
              {dealDesk ? (
                <Box marginLeft={layout.dealDesk.inset}>
                  {dealDesk(layout.dealDesk.width)}
                </Box>
              ) : null}
            </Box>
          </>
        ) : (
          <Box marginTop={1} width={layout.tips.width} flexDirection="column">
            <TipsPanel width={layout.tips.width} />
            {dealDesk ? (
              <Box marginTop={1}>{dealDesk(layout.dealDesk.width)}</Box>
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function MascotIntro({ greeting }: IntroProps) {
  const t = useTheme();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  const intro = useIntroAnimation(cols, true, exit);

  useEffect(() => {
    if (!stdout) return;
    const handler = () => setCols(stdout.columns ?? 80);
    stdout.on("resize", handler);
    return () => {
      stdout.off("resize", handler);
    };
  }, [stdout]);

  useInput((_input, key) => {
    if (key.escape || key.return || (key.ctrl && _input === "c")) exit();
  });

  const barColor = introPhaseColor(intro.colorPhase, t);

  return (
    <MascotDashboard
      greeting={greeting}
      width={cols}
      state={intro.state}
      bar={intro.bar}
      barColor={barColor}
      mascotStatus={intro.status}
    />
  );
}
