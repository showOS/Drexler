import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export type DealDeskHeaderStatus = "idle" | "streaming" | "error";

export interface DealDeskHeaderProps {
  mood: string;
  messageCount: number;
  status?: DealDeskHeaderStatus;
  compact?: boolean;
  notice?: string;
  maxWidth?: number;
  marginBottom?: number;
}

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 1;
const FRAMED_MIN_WIDTH = 24;

const BOARDROOM_STATUS: Record<DealDeskHeaderStatus, string> = {
  idle: "BOARDROOM OPEN",
  streaming: "MEMO LIVE",
  error: "COUNSEL PANIC",
};

type DealDeskPoolKey =
  | "fees"
  | "mandate"
  | "risk"
  | "counsel"
  | "morale"
  | "synergy";

const DEFAULT_POOL: Record<DealDeskPoolKey, readonly string[]> = {
  fees: ["accruing", "sacred", "non-refundable", "already billed"],
  mandate: ["self-awarded", "board-adjacent", "strategic-ish", "lightly authorized"],
  risk: ["theatrical", "outsourced", "priced in", "someone else's"],
  counsel: ["circling", "evasive", "comfortable", "redlining lunch"],
  morale: ["impaired", "marked down", "technically solvent", "under review"],
  synergy: ["alleged", "unverifiable", "already billed", "pending lawsuit"],
};

const MOOD_POOLS: Record<
  string,
  Partial<Record<DealDeskPoolKey, readonly string[]>>
> = {
  angry: {
    fees: ["weaponized", "escalating", "aggressively earned", "non-refundable"],
    mandate: ["hostile", "loudly implied", "board-threatening", "self-ratified"],
    risk: ["acceptable", "transferred", "career-limiting", "somebody else's"],
    counsel: ["circling", "sweating", "denying knowledge", "overruled"],
    morale: ["terminated", "impaired", "written off", "reassigned"],
    synergy: ["forced", "mandatory", "hostile", "already billed"],
  },
  exhausted: {
    fees: ["still accruing", "quietly sacred", "tired but billable", "unquestioned"],
    mandate: ["unclear", "half-approved", "forgotten", "pending coffee"],
    risk: ["deferred", "sleepy", "filed tomorrow", "emotionally hedged"],
    counsel: ["unavailable", "out of office", "blinking slowly", "circling"],
    morale: ["written off", "napping", "below guidance", "technically awake"],
    synergy: ["alleged", "too tired to verify", "softly promised", "unfunded"],
  },
  paranoid: {
    fees: ["traced", "escrowed twice", "suspiciously round", "under seal"],
    mandate: ["encrypted", "deniable", "need-to-know", "redacted"],
    risk: ["everywhere", "listening", "unhedged", "wearing a wire"],
    counsel: ["whispering", "triple-checking", "using burner phones", "redacting"],
    morale: ["surveilled", "compartmentalized", "need-to-know", "encrypted"],
    synergy: ["classified", "denied", "redacted", "not in minutes"],
  },
  generous: {
    fees: ["shared emotionally", "still ours", "politely accruing", "gift-wrapped"],
    mandate: ["benevolent", "magnanimous", "soft hostile", "board-blessed"],
    risk: ["forgiven", "socialized", "gently transferred", "nicely hedged"],
    counsel: ["agreeable", "smiling carefully", "comfortable", "charitable"],
    morale: ["briefly up", "subsidized", "pleasantly marked", "gifted options"],
    synergy: ["donated", "mutual-ish", "kindly alleged", "complimentary"],
  },
  ruthless: {
    fees: ["sacred", "extractive", "fully captured", "compounding"],
    mandate: ["hostile", "absolute", "self-awarded", "non-appealable"],
    risk: ["outsourced", "priced in", "assigned to interns", "deleted"],
    counsel: ["overpaid", "comfortable", "aggressively calm", "circling"],
    morale: ["impaired", "irrelevant", "restructured", "sold separately"],
    synergy: ["mandatory", "already billed", "non-consensual", "accretive"],
  },
  victorious: {
    fees: ["captured", "celebrated", "fully earned", "ringing bell"],
    mandate: ["ratified", "triumphant", "board-crowned", "unopposed"],
    risk: ["conquered", "renamed upside", "priced in", "defeated"],
    counsel: ["applauding", "comfortable", "drafting trophies", "filing confetti"],
    morale: ["temporarily high", "marked up", "wearing medals", "overstated"],
    synergy: ["declared", "victorious", "already billed", "banner-ready"],
  },
};

function clampText(input: string, max: number): string {
  if (max <= 0) return "";
  return fitDisplayText(input, max);
}

function padToWidth(input: string, width: number): string {
  const len = displayWidth(input);
  if (len >= width) return input;
  return `${input}${" ".repeat(width - len)}`;
}

function shellLine(left: string, right: string, width: number): string {
  const available = Math.max(0, width - displayWidth(left) - displayWidth(right));
  return `${left}${"─".repeat(available)}${right}`;
}

function bodyLine(content: string, width: number): string {
  const innerWidth = Math.max(0, width - 4);
  return `│ ${padToWidth(clampText(content, innerWidth), innerWidth)} │`;
}

function memoLabel(messageCount: number): string {
  const noun = "memo";
  return `${messageCount} ${noun}${messageCount === 1 ? "" : "s"}`;
}

function tinyLine({
  messageCount,
  status,
  width,
}: {
  messageCount: number;
  status: DealDeskHeaderStatus;
  width: number;
}): string {
  return clampText(
    `${BOARDROOM_STATUS[status]} ${memoLabel(messageCount)}`,
    width,
  );
}

function pickFromMoodPool({
  key,
  mood,
  salt,
}: {
  key: DealDeskPoolKey;
  mood: string;
  salt: number;
}): string {
  const pool = MOOD_POOLS[mood.toLowerCase()]?.[key] ?? DEFAULT_POOL[key];
  return pool[Math.abs(salt) % pool.length] ?? DEFAULT_POOL[key][0];
}

function hashDealDesk(input: string): number {
  let hash = 2166136261;
  for (let idx = 0; idx < input.length; idx++) {
    hash ^= input.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatCells(cells: string[], width: number): string {
  const separator = "  │  ";
  const available = Math.max(
    1,
    width - displayWidth(separator) * Math.max(0, cells.length - 1),
  );
  const base = Math.max(1, Math.floor(available / cells.length));
  const remainder = Math.max(0, available - base * cells.length);
  return cells
    .map((cell, idx) => {
      const cellWidth = base + (idx < remainder ? 1 : 0);
      return padToWidth(clampText(cell, cellWidth), cellWidth);
    })
    .join(separator);
}

function buildHeaderLines({
  mood,
  messageCount,
  status,
  compact,
  notice,
  width,
  seed,
}: {
  mood: string;
  messageCount: number;
  status: DealDeskHeaderStatus;
  compact: boolean;
  notice?: string;
  width: number;
  seed: number;
}): string[] {
  const innerWidth = Math.max(1, width - 4);
  const baseHash = hashDealDesk(`${mood}:${messageCount}:${status}:${seed}`);
  const pick = (key: DealDeskPoolKey, offset: number) =>
    pickFromMoodPool({ key, mood, salt: baseHash + offset * 7919 });
  const statusLabel = BOARDROOM_STATUS[status];
  const summary = compact
    ? formatCells(
        [`● ${statusLabel}`, `mood ${mood}`, `fees ${pick("fees", 1)}`],
        innerWidth,
      )
    : formatCells(
        [
          `● ${statusLabel}`,
          memoLabel(messageCount),
          `fees ${pick("fees", 1)}`,
        ],
        innerWidth,
      );
  const readout = compact
    ? formatCells(
        [`risk ${pick("risk", 2)}`, `counsel ${pick("counsel", 3)}`],
        innerWidth,
      )
    : formatCells(
        [
          `mandate ${pick("mandate", 4)}`,
          `risk ${pick("risk", 5)}`,
          `counsel ${pick("counsel", 6)}`,
        ],
        innerWidth,
      );
  const lines = [bodyLine(summary, width), bodyLine(readout, width)];

  if (!compact && notice && notice.trim().length > 0) {
    const memo = formatCells(
        [
          `memo ${notice.trim()}`,
          `morale ${pick("morale", 7)}`,
          `synergy ${pick("synergy", 8)}`,
        ],
      innerWidth,
    );
    lines.push(bodyLine(memo, width));
  }

  lines.push(shellLine("╰", "╯", width));
  return lines;
}

function titleLabel(compact: boolean): string {
  return compact ? "Drexler" : "Drexler Deal Desk";
}

function FramedTitleText({
  compact,
  borderColor,
  titleColor,
  width,
}: {
  compact: boolean;
  borderColor: string;
  titleColor: string;
  width: number;
}) {
  const title = titleLabel(compact);
  const prefix = "╭─ ";
  const titleSuffix = " ";
  const suffix = "╮";
  const ruleWidth = Math.max(
    0,
    width -
      displayWidth(prefix) -
      displayWidth(title) -
      displayWidth(titleSuffix) -
      displayWidth(suffix),
  );
  return (
    <Text>
      <Text color={borderColor}>{prefix}</Text>
      <Text bold color={titleColor}>
        {title}
      </Text>
      <Text color={borderColor}>
        {titleSuffix}
        {"─".repeat(ruleWidth)}
        {suffix}
      </Text>
    </Text>
  );
}

function FramedBodyText({
  line,
  borderColor,
  contentColor,
}: {
  line: string;
  borderColor: string;
  contentColor: string;
}) {
  const content = line.length >= 4 ? line.slice(2, -2) : line;
  return (
    <Text>
      <Text color={borderColor}>│ </Text>
      <Text color={contentColor}>{content}</Text>
      <Text color={borderColor}> │</Text>
    </Text>
  );
}

function DealDeskHeaderInner({
  mood,
  messageCount,
  status = "idle",
  compact = false,
  notice,
  maxWidth = DEFAULT_WIDTH,
  marginBottom = 1,
}: DealDeskHeaderProps) {
  const t = useTheme();
  const width = Math.max(MIN_WIDTH, Math.floor(maxWidth));
  const randomSeed = useMemo(() => Math.floor(Math.random() * 1_000_000_000), []);
  const statusColor: Record<DealDeskHeaderStatus, string> = useMemo(
    () => ({
      idle: t.primaryLight,
      streaming: t.warning,
      error: t.error,
    }),
    [t.error, t.primaryLight, t.warning],
  );
  const summaryColor = status === "idle" ? t.text : statusColor[status];
  const lines = useMemo(
    () =>
      buildHeaderLines({
        mood,
        messageCount,
        status,
        compact,
        notice,
        width,
        seed: randomSeed,
      }),
    [
      compact,
      messageCount,
      mood,
      notice,
      randomSeed,
      status,
      width,
    ],
  );

  if (width < FRAMED_MIN_WIDTH) {
    return (
      <Box width={width} marginBottom={marginBottom}>
        <Text color={statusColor[status]} wrap="truncate">
          {tinyLine({ messageCount, status, width })}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} marginBottom={marginBottom}>
      <FramedTitleText
        compact={compact}
        borderColor={t.primary}
        titleColor={t.primaryLight}
        width={width}
      />
      <FramedBodyText
        line={lines[0] ?? ""}
        borderColor={t.primary}
        contentColor={summaryColor}
      />
      {lines.slice(1, -1).map((line, index) => (
        <FramedBodyText
          key={index}
          line={line}
          borderColor={t.primary}
          contentColor={index === 0 ? t.text : t.dim}
        />
      ))}
      <Text color={t.primary}>{lines[lines.length - 1]}</Text>
    </Box>
  );
}

export const DealDeskHeader = memo(DealDeskHeaderInner);
