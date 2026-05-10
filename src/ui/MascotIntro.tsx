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
  mood?: string;
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

  if (width < 24) {
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

  const panelWidth = Math.max(18, Math.min(44, width));
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

export function MascotDashboard({
  greeting,
  width,
  mood,
  bootProgress = 1,
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
  const wideGreetingRows = sideBySide
    ? fixedDisplayRows(greeting, copyWidth, 2)
    : [];

  if (tinyTerminal) {
    return (
      <Box width={available} flexDirection="column">
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
            width={available}
          />
        </Box>
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
        <Box marginTop={1}>
          <MoodReadout
            mood={mood}
            progress={bootProgress}
            progressColor={resolvedBarColor}
            width={available}
          />
        </Box>
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
              width={copyWidth}
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
