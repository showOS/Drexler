import { Box, Text } from "ink";
import { memo } from "react";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export interface SynergyEventDefinition {
  id: string;
  title: string;
  subtitle: string;
  art: readonly string[];
  stages: readonly string[];
  kpis: readonly string[];
  finalLine: string;
  transcriptLine: string;
}

export const SYNERGY_EVENT_FRAMES = 28;
const FULL_EVENT_WIDTH = 88;
const FULL_EVENT_ROWS = 12;
const FULL_EVENT_ART_ROWS = 4;

export const SYNERGY_EVENTS: readonly SynergyEventDefinition[] = [
  {
    id: "alignment-protocol",
    title: "ALIGNMENT PROTOCOL",
    subtitle: "cross-functional theater detected",
    art: [
      "   ██████╗ ██╗   ██╗███╗   ██╗",
      "  ██╔════╝ ╚██╗ ██╔╝████╗  ██║",
      "  ╚█████╗   ╚████╔╝ ██╔██╗ ██║",
      "   ╚═══██╗   ╚██╔╝  ██║╚██╗██║",
      "  ██████╔╝    ██║   ██║ ╚████║",
      "  ╚═════╝     ╚═╝   ╚═╝  ╚═══╝",
    ],
    stages: [
      "initiating alignment protocol",
      "harmonizing action items",
      "converting meetings into margin",
      "minting provisional shareholder value",
    ],
    kpis: [
      "EBITDA +0.4%",
      "morale provisionally approved",
      "consultants +7",
      "clarity -3",
    ],
    finalLine:
      "Synergy achieved. Headcount unchanged. Morale amortized.",
    transcriptLine: "SYNERGY EVENT: shareholder value allegedly unlocked.",
  },
  {
    id: "boardroom-alert",
    title: "BOARDROOM ALERT",
    subtitle: "value creation siren armed",
    art: [
      "  [!] BOARDROOM ALERT",
      "  [!] ALIGNMENT DETECTED",
      "  [!] VALUE CREATION IMMINENT",
      "  [!] ASK NO FOLLOW-UP QUESTIONS",
    ],
    stages: [
      "paging senior stakeholders",
      "escalating morale to committee",
      "routing accountability offshore",
      "closing the loop with no loop",
    ],
    kpis: [
      "risk committee awake",
      "action items multiplying",
      "status: billable",
      "decision rights unclear",
    ],
    finalLine: "Drexler approves synergy. Nobody asks what changed.",
    transcriptLine: "SYNERGY EVENT: boardroom siren produced measurable vibes.",
  },
  {
    id: "briefcase-cameo",
    title: "BRIEFCASE CAMEO",
    subtitle: "executive artifact opening",
    art: [
      "        _________",
      "      _/  ___   \\_",
      "     |  $     $   |",
      "     |  ───┬───   |",
      "     |_____|_______|",
      "        /  |  \\",
    ],
    stages: [
      "unlocking sealed mandate",
      "counting invisible efficiencies",
      "deploying tasteful corporate sparkle",
      "reclassifying excitement as asset",
    ],
    kpis: [
      "briefcase yield +12 bps",
      "sparkle reserve funded",
      "memo density rising",
      "bonus pool unchanged",
    ],
    finalLine: "Briefcase open. Synergy escaped. Legal says it was planned.",
    transcriptLine: "SYNERGY EVENT: briefcase opened and released approved optimism.",
  },
  {
    id: "achievement-unlocked",
    title: "ACHIEVEMENT UNLOCKED",
    subtitle: "cross-functional theater",
    art: [
      "      ╔══════════════════╗",
      "      ║  DEAL TROPHY +1  ║",
      "      ╚══════════════════╝",
      "        Reward: meeting",
      "        Status: billable",
    ],
    stages: [
      "checking performance conditions",
      "unlocking meeting about meeting",
      "allocating credit to leadership",
      "filing victory under recurring revenue",
    ],
    kpis: [
      "achievement: unlocked",
      "reward: one calendar invite",
      "prestige +8",
      "substance pending",
    ],
    finalLine: "Achievement unlocked: Cross-Functional Theater.",
    transcriptLine: "SYNERGY EVENT: achievement unlocked, substance pending.",
  },
];

export function pickSynergyEvent(
  random: () => number = Math.random,
): SynergyEventDefinition {
  const idx = Math.min(
    SYNERGY_EVENTS.length - 1,
    Math.floor(random() * SYNERGY_EVENTS.length),
  );
  return SYNERGY_EVENTS[idx]!;
}

function frameProgress(frame: number): number {
  return Math.max(0, Math.min(1, frame / (SYNERGY_EVENT_FRAMES - 1)));
}

function bar(progress: number, width: number): string {
  const safeWidth = Math.max(1, width);
  const filled = Math.max(0, Math.min(safeWidth, Math.round(progress * safeWidth)));
  return `${"█".repeat(filled)}${"░".repeat(safeWidth - filled)}`;
}

function stageAt(event: SynergyEventDefinition, frame: number): string {
  const progress = frameProgress(frame);
  const idx = Math.min(
    event.stages.length - 1,
    Math.floor(progress * event.stages.length),
  );
  return event.stages[idx]!;
}

function visibleArt(event: SynergyEventDefinition, frame: number): readonly string[] {
  const progress = frameProgress(frame);
  const count = Math.max(
    1,
    Math.ceil(progress * Math.min(event.art.length, FULL_EVENT_ART_ROWS)),
  );
  return event.art.slice(0, count);
}

function kpiAt(event: SynergyEventDefinition, frame: number): string {
  return event.kpis[Math.floor(frame / 3) % event.kpis.length]!;
}

interface Props {
  event: SynergyEventDefinition;
  frame: number;
  width?: number;
  compact?: boolean;
}

function SynergyEventInner({
  event,
  frame,
  width = 80,
  compact = false,
}: Props) {
  const t = useTheme();
  const safeWidth = Math.max(1, Math.floor(width));
  const progress = frameProgress(frame);
  const done = frame >= SYNERGY_EVENT_FRAMES - 1;
  const tiny = safeWidth < 38 || compact;

  if (tiny) {
    const label = done ? event.finalLine : stageAt(event, frame);
    const miniBarWidth = Math.max(4, Math.min(18, safeWidth - 12));
    const line = `SYNC ${bar(progress, miniBarWidth)} ${label}`;
    return (
      <Box width={safeWidth} flexShrink={1}>
        <Text color={done ? t.primaryLight : t.warning} bold wrap="truncate">
          {fitDisplayText(line, safeWidth)}
        </Text>
      </Box>
    );
  }

  const panelWidth = Math.min(safeWidth, FULL_EVENT_WIDTH);
  const innerWidth = Math.max(1, panelWidth - 4);
  const title = `${event.title} · ${event.subtitle}`;
  const progressWidth = Math.max(8, Math.min(34, innerWidth - 18));
  const progressPct = `${Math.round(progress * 100)
    .toString()
    .padStart(3, " ")}%`;
  const artWidth = Math.max(1, innerWidth - 4);
  const kpi = kpiAt(event, frame);

  return (
    <Box width={safeWidth} justifyContent="center" flexShrink={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={done ? t.primaryLight : t.warning}
        paddingX={1}
        width={panelWidth}
        flexShrink={1}
      >
        <Box>
          <Text color={t.warning} bold>
            SYNERGY EVENT
          </Text>
          <Text color={t.primaryDim}> ─ </Text>
          <Text color={t.dim} wrap="truncate">
            {fitDisplayText(title, Math.max(1, innerWidth - 18))}
          </Text>
        </Box>
        <Box flexDirection="column">
          {event.art.slice(0, FULL_EVENT_ART_ROWS).map((line, idx) => {
            const revealed = idx < visibleArt(event, frame).length;
            return (
              <Text
                key={`${event.id}-${idx}`}
                color={revealed ? t.primaryLight : t.primaryDim}
                wrap="truncate"
              >
                {revealed ? fitDisplayText(line, artWidth) : " "}
              </Text>
            );
          })}
        </Box>
        <Box>
          <Text color={t.primaryDim}>[</Text>
          <Text color={done ? t.primaryLight : t.warning}>
            {bar(progress, progressWidth)}
          </Text>
          <Text color={t.primaryDim}>] </Text>
          <Text color={t.dim}>{progressPct}</Text>
        </Box>
        <Box>
          <Text color={t.primaryLight} bold>
            ◆{" "}
          </Text>
          <Text color={t.text} wrap="truncate">
            {fitDisplayText(stageAt(event, frame), Math.max(1, innerWidth - 4))}
          </Text>
        </Box>
        <Box>
          <Text color={t.primaryDim}>ticker </Text>
          <Text color={t.warning} wrap="truncate">
            {fitDisplayText(kpi, Math.max(1, innerWidth - 9))}
          </Text>
        </Box>
        <Box>
          <Text color={done ? t.primaryLight : t.primaryDim} bold={done} wrap="truncate">
            {fitDisplayText(
              done ? event.finalLine : "awaiting committee approval...",
              Math.max(1, innerWidth - 2),
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export const SynergyEvent = memo(SynergyEventInner);

export function synergyEventRows(width: number, compact = false): number {
  if (compact || width < 38) return 1;
  return FULL_EVENT_ROWS;
}

export function synergyEventMaxRowWidth(
  rendered: string,
  stripAnsi: (s: string) => string = (s) => s,
): number {
  return Math.max(
    0,
    ...stripAnsi(rendered)
      .split("\n")
      .map((row) => displayWidth(row)),
  );
}
