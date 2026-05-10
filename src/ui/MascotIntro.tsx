import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { STARTUP_TIPS } from "../startupTips.ts";
import {
  MascotFrame,
  MASCOT_WIDTH,
  type MascotState,
} from "./MascotFrame.tsx";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
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

interface IntroProps {
  greeting: string;
}

interface MascotDashboardProps {
  greeting: string;
  width: number;
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

function titledPanelBottom(width: number): string {
  return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

type IntroColorPhase = "early" | "middle" | "late";

function introTotalFrames(width: number): number {
  return width < 72 ? COMPACT_INTRO_NOTES.length : INTRO_FRAMES.length;
}

function introFrameDelayMs(frameIdx: number, width: number): number {
  if (width < 72) return COMPACT_INTRO_DELAY_MS;
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
  const compact = width < 72;
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

export function MascotDashboard({
  greeting,
  width,
  state = INTRO_FRAMES[INTRO_FRAMES.length - 1]!,
  bar = introBootBar(INTRO_FRAMES.length - 1, INTRO_FRAMES.length),
  barColor,
  mascotStatus = `${INTRO_STATUS_PREFIX}${INTRO_BOOT_NOTES[INTRO_BOOT_NOTES.length - 1]}`,
  dealDesk,
}: MascotDashboardProps) {
  const t = useTheme();
  const resolvedBarColor = barColor ?? t.primaryLight;
  const tinyTerminal = width < 21;
  const compact = width < 72;
  const sideBySide = width >= 112;
  const available = compact ? Math.max(1, width - 1) : Math.max(28, width);
  const innerWidth = compact
    ? available
    : Math.max(24, available - FRAME_CHROME_WIDTH);
  const leftPanelWidth = compact
    ? available
    : sideBySide
    ? Math.max(
        MASCOT_WIDTH + GUTTER_WIDTH + 24,
        Math.floor((innerWidth - SPLIT_DIVIDER_WIDTH) / 2),
      )
    : innerWidth;
  const rightColumnWidth = sideBySide
    ? Math.max(20, innerWidth - leftPanelWidth - SPLIT_DIVIDER_WIDTH)
    : innerWidth;
  const rightInnerWidth = sideBySide
    ? Math.max(1, rightColumnWidth - 1)
    : rightColumnWidth;
  const tipsWidth = sideBySide
    ? rightInnerWidth
    : innerWidth;
  const copyWidth = compact
    ? available
    : sideBySide
    ? Math.max(18, leftPanelWidth - MASCOT_WIDTH - GUTTER_WIDTH - 1)
    : innerWidth;

  if (tinyTerminal) {
    return (
      <Box width={available} flexDirection="column">
        <Text color={resolvedBarColor}>{mascotStatus}</Text>
        <Text bold color={t.primaryLight}>
          Drexler™
        </Text>
        <Text color={t.primaryLight}>{greeting}</Text>
        {dealDesk ? <Box marginTop={1}>{dealDesk(Math.max(1, available))}</Box> : null}
      </Box>
    );
  }

  if (compact) {
    return (
      <Box marginLeft={1} width={available} flexDirection="column">
        <Text color={resolvedBarColor}>{bar}</Text>
        <Text color={resolvedBarColor}>{mascotStatus}</Text>
        <Text bold color={t.primaryLight}>
          Drexler International™
        </Text>
        <Text color={t.primaryLight}>{greeting}</Text>
        {dealDesk ? <Box marginTop={1}>{dealDesk(Math.max(1, available))}</Box> : null}
      </Box>
    );
  }

  return (
    <Box width={available}>
      <Box
        width={available}
        borderStyle="round"
        borderColor={t.primary}
        paddingX={1}
        flexDirection={sideBySide ? "row" : "column"}
        alignItems={sideBySide ? "flex-start" : "center"}
      >
        <Box flexDirection={sideBySide ? "row" : "column"} width={leftPanelWidth}>
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
            width={copyWidth}
            marginTop={sideBySide ? 1 : 0}
          >
            <Text bold color={t.primaryLight}>
              Drexler International™
            </Text>
            <Box height={1} />
            <Text color={t.primaryLight}>{greeting}</Text>
            <Box height={1} />
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
              width={rightColumnWidth}
              paddingRight={1}
            >
              <Box marginLeft={1}>
                <TipsPanel width={Math.max(1, rightInnerWidth - 1)} />
              </Box>
              {dealDesk ? (
                <Box marginLeft={1}>
                  {dealDesk(Math.max(1, rightInnerWidth - 1))}
                </Box>
              ) : null}
            </Box>
          </>
        ) : (
          <Box marginTop={1} width={tipsWidth} flexDirection="column">
            <TipsPanel width={tipsWidth} />
            {dealDesk ? <Box marginTop={1}>{dealDesk(tipsWidth)}</Box> : null}
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
