import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STARTUP_TIPS } from "../startupTips.ts";
import {
  MascotFrame,
  MASCOT_WIDTH,
  type MascotState,
} from "./MascotFrame.tsx";
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

const FRAMES: IntroFrame[] = [
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

const COMPACT_NOTES = ["Booting", "Scanning", "Online"];
const COMPACT_DELAY_MS = 850;
const SETTLE_HOLD_MS = 1200;
const FRAME_CHROME_WIDTH = 4;
const GUTTER_WIDTH = 4;
const BOOT_BAR_WIDTH = MASCOT_WIDTH - 1;
const RIGHT_COLUMN_BORDER_WIDTH = 2;

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

function bootBar(frameIdx: number, total: number): string {
  const active = Math.max(
    1,
    Math.ceil(((frameIdx + 1) / total) * BOOT_BAR_WIDTH),
  );
  return " " + "▰".repeat(active) + "▱".repeat(BOOT_BAR_WIDTH - active);
}

function TipsPanel({ width }: { width: number }) {
  const t = useTheme();
  const textWidth = Math.max(1, width);
  return (
    <Box flexDirection="column" width={textWidth}>
      <Text bold color={t.primaryLight}>
        Tips for getting started
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {STARTUP_TIPS.map((tip, idx) => (
          <Text key={tip} color={t.dim}>
            <Text color={t.primary}>{idx + 1}. </Text>
            {tip}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function MascotDashboard({
  greeting,
  width,
  state = FRAMES[FRAMES.length - 1]!,
  bar = bootBar(FRAMES.length - 1, FRAMES.length),
  barColor,
  mascotStatus = `${INTRO_STATUS_PREFIX}${INTRO_BOOT_NOTES[INTRO_BOOT_NOTES.length - 1]}`,
  dealDesk,
}: MascotDashboardProps) {
  const t = useTheme();
  const resolvedBarColor = barColor ?? t.primaryLight;
  const tinyTerminal = width < 21;
  const compact = width < 72;
  const sideBySide = width >= 112;
  const available = compact ? Math.max(1, width - 1) : Math.max(28, width - 1);
  const innerWidth = compact
    ? available
    : Math.max(24, available - FRAME_CHROME_WIDTH);
  const leftPanelWidth = compact
    ? available
    : sideBySide
    ? Math.max(
        MASCOT_WIDTH + GUTTER_WIDTH + 24,
        Math.floor((innerWidth - RIGHT_COLUMN_BORDER_WIDTH) / 2),
      )
    : innerWidth;
  const rightColumnWidth = sideBySide
    ? Math.max(20, innerWidth - leftPanelWidth)
    : innerWidth;
  const rightInnerWidth = sideBySide
    ? Math.max(1, rightColumnWidth - RIGHT_COLUMN_BORDER_WIDTH)
    : rightColumnWidth;
  const tipsWidth = sideBySide
    ? rightInnerWidth
    : innerWidth;
  const copyWidth = compact
    ? available
    : sideBySide
    ? Math.max(18, leftPanelWidth - MASCOT_WIDTH - GUTTER_WIDTH)
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
            <Box
              flexDirection="column"
              width={rightColumnWidth}
              borderLeft
              borderColor={t.primaryDim}
              paddingLeft={1}
            >
              <TipsPanel width={rightInnerWidth} />
              {dealDesk ? <Box marginTop={1}>{dealDesk(rightInnerWidth)}</Box> : null}
            </Box>
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
  const [frameIdx, setFrameIdx] = useState(0);

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

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const compact = cols < 72;
    const total = compact ? COMPACT_NOTES.length : FRAMES.length;
    if (frameIdx >= total - 1) {
      const handle = setTimeout(() => {
        if (mountedRef.current) exit();
      }, SETTLE_HOLD_MS);
      return () => clearTimeout(handle);
    }
    const delay = compact
      ? COMPACT_DELAY_MS
      : (FRAMES[frameIdx] ?? FRAMES[FRAMES.length - 1]!).delayMs;
    const handle = setTimeout(() => {
      if (mountedRef.current) setFrameIdx((i) => i + 1);
    }, delay);
    return () => clearTimeout(handle);
  }, [cols, frameIdx, exit]);

  const state = FRAMES[frameIdx] ?? FRAMES[FRAMES.length - 1]!;
  const compact = cols < 72;
  const bar = bootBar(
    Math.min(frameIdx, compact ? COMPACT_NOTES.length - 1 : FRAMES.length - 1),
    compact ? COMPACT_NOTES.length : FRAMES.length,
  );
  const barColor =
    frameIdx < (compact ? COMPACT_NOTES.length : FRAMES.length) / 3
      ? t.error
      : frameIdx < ((compact ? COMPACT_NOTES.length : FRAMES.length) * 2) / 3
      ? t.warning
      : t.primaryLight;
  const note = compact
    ? COMPACT_NOTES[Math.min(frameIdx, COMPACT_NOTES.length - 1)]!
    : state.note;
  const mascotStatus = `${INTRO_STATUS_PREFIX}${note}`;

  return (
    <MascotDashboard
      greeting={greeting}
      width={cols}
      state={state}
      bar={bar}
      barColor={barColor}
      mascotStatus={mascotStatus}
    />
  );
}
