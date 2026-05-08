import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
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
const SPLIT_DIVIDER_WIDTH = 3;
const BOOT_BAR_WIDTH = MASCOT_WIDTH - 1;
const SPLIT_DIVIDER_HEIGHT = 9;

interface IntroProps {
  greeting: string;
}

function bootBar(frameIdx: number, total: number): string {
  const active = Math.max(
    1,
    Math.ceil(((frameIdx + 1) / total) * BOOT_BAR_WIDTH),
  );
  return " " + "▰".repeat(active) + "▱".repeat(BOOT_BAR_WIDTH - active);
}

function ellipsize(input: string, max: number): string {
  if (input.length <= max) return input;
  if (max <= 1) return "…";
  return input.slice(0, max - 1) + "…";
}

function TipsPanel({ width }: { width: number }) {
  const t = useTheme();
  const textWidth = Math.max(1, width);
  return (
    <Box flexDirection="column" width={textWidth}>
      <Text bold color={t.primaryLight}>
        {ellipsize("Tips for getting started", textWidth)}
      </Text>
      {STARTUP_TIPS.map((tip, idx) => (
        <Text key={tip} color={t.dim}>
          <Text color={t.primary}>{idx + 1}. </Text>
          {ellipsize(tip, Math.max(1, textWidth - 3))}
        </Text>
      ))}
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
    if (key.ctrl && _input === "c") exit();
  });

  useEffect(() => {
    const compact = cols < 72;
    const total = compact ? COMPACT_NOTES.length : FRAMES.length;
    if (frameIdx >= total - 1) {
      const handle = setTimeout(() => exit(), SETTLE_HOLD_MS);
      return () => clearTimeout(handle);
    }
    const delay = compact
      ? COMPACT_DELAY_MS
      : (FRAMES[frameIdx] ?? FRAMES[FRAMES.length - 1]!).delayMs;
    const handle = setTimeout(() => setFrameIdx((i) => i + 1), delay);
    return () => clearTimeout(handle);
  }, [cols, frameIdx, exit]);

  const state = FRAMES[frameIdx] ?? FRAMES[FRAMES.length - 1]!;
  const compact = cols < 72;
  const sideBySide = cols >= 112;
  const available = compact
    ? Math.max(1, cols - 1)
    : Math.max(28, cols);
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
  const tipsWidth = sideBySide
    ? Math.max(20, innerWidth - leftPanelWidth - SPLIT_DIVIDER_WIDTH)
    : innerWidth;
  const copyWidth = compact
    ? available
    : sideBySide
    ? Math.max(18, leftPanelWidth - MASCOT_WIDTH - GUTTER_WIDTH)
    : innerWidth;
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
  const greetingText = useMemo(
    () => ellipsize(greeting, copyWidth),
    [copyWidth, greeting],
  );

  if (compact) {
    return (
      <Box marginLeft={1} width={available} flexDirection="column">
        <Text color={barColor}>{bar}</Text>
        <Text color={barColor}>{mascotStatus}</Text>
        <Text bold color={t.primaryLight}>
          Drexler International™
        </Text>
        <Text color={t.primaryLight}>{greetingText}</Text>
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
            <Text color={barColor}>{bar}</Text>
            <Text color={barColor}>{mascotStatus}</Text>
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
            <Text color={t.primaryLight}>{greetingText}</Text>
            <Box height={1} />
          </Box>
        </Box>
        {sideBySide ? (
          <>
            <Box flexDirection="column" width={SPLIT_DIVIDER_WIDTH}>
              {Array.from({ length: SPLIT_DIVIDER_HEIGHT }).map((_, idx) => (
                <Text key={idx} color={t.primaryDim}>
                  {" │ "}
                </Text>
              ))}
            </Box>
            <Box width={tipsWidth}>
              <TipsPanel width={tipsWidth} />
            </Box>
          </>
        ) : (
          <Box marginTop={1} width={tipsWidth}>
            <TipsPanel width={tipsWidth} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
