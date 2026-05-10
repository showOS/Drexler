import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export type DealDeskHeaderStatus = "idle" | "streaming" | "error";

export interface DealDeskHeaderProps {
  model: string;
  mood: string;
  messageCount: number;
  themeName?: string;
  approximateTokens?: number;
  latencyMs?: number | null;
  fallbackModel?: string | null;
  status?: DealDeskHeaderStatus;
  compact?: boolean;
  notice?: string;
  maxWidth?: number;
  marginBottom?: number;
}

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 1;
const FRAMED_MIN_WIDTH = 24;

const STATUS_LABEL: Record<DealDeskHeaderStatus, string> = {
  idle: "READY",
  streaming: "LIVE",
  error: "ERROR",
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

function countLabel(messageCount: number, compact: boolean): string {
  if (compact) return `${messageCount} msg${messageCount === 1 ? "" : "s"}`;
  return `${messageCount} message${messageCount === 1 ? "" : "s"}`;
}

function latencyLabel(latencyMs: number | null | undefined): string | null {
  if (typeof latencyMs !== "number") return null;
  if (latencyMs < 1000) return `${Math.max(0, Math.round(latencyMs))}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

function tinyLine({
  model,
  messageCount,
  status,
  width,
}: {
  model: string;
  messageCount: number;
  status: DealDeskHeaderStatus;
  width: number;
}): string {
  return clampText(
    `${STATUS_LABEL[status]} ${countLabel(messageCount, true)} ${model}`,
    width,
  );
}

function buildHeaderLines({
  model,
  mood,
  messageCount,
  themeName,
  approximateTokens,
  latencyMs,
  fallbackModel,
  status,
  compact,
  notice,
  width,
}: {
  model: string;
  mood: string;
  messageCount: number;
  themeName?: string;
  approximateTokens?: number;
  latencyMs?: number | null;
  fallbackModel?: string | null;
  status: DealDeskHeaderStatus;
  compact: boolean;
  notice?: string;
  width: number;
}): string[] {
  const statusLabel = STATUS_LABEL[status];
  const latency = latencyLabel(latencyMs);
  const top = compact
    ? shellLine("┌ Drexler ", "┐", width)
    : shellLine("┌ Drexler Deal Desk ", "┐", width);

  const summary = compact
    ? `● ${statusLabel}  ${model}  ${countLabel(messageCount, true)}${
        latency ? `  ${latency}` : ""
      }`
    : `● ${statusLabel}  │  ${countLabel(
        messageCount,
        false,
      )}  │  ~${approximateTokens ?? 0} tok  │  ${latency ?? "no run yet"}`;
  const detail = `model ${model}  │  mood ${mood}  │  theme ${
    themeName ?? "apollo"
  }${fallbackModel ? `  │  fallback ${fallbackModel}` : ""}`;
  const lines = [top, bodyLine(summary, width)];

  if (!compact) {
    lines.push(bodyLine(detail, width));
  }

  if (!compact && notice && notice.trim().length > 0) {
    lines.push(bodyLine(`notice ${notice.trim()}`, width));
  }

  lines.push(shellLine("└", "┘", width));
  return lines;
}

function DealDeskHeaderInner({
  model,
  mood,
  messageCount,
  themeName,
  approximateTokens,
  latencyMs,
  fallbackModel,
  status = "idle",
  compact = false,
  notice,
  maxWidth = DEFAULT_WIDTH,
  marginBottom = 1,
}: DealDeskHeaderProps) {
  const t = useTheme();
  const width = Math.max(MIN_WIDTH, Math.floor(maxWidth));
  const statusColor: Record<DealDeskHeaderStatus, string> = useMemo(
    () => ({
      idle: t.primaryLight,
      streaming: t.warning,
      error: t.error,
    }),
    [t.error, t.primaryLight, t.warning],
  );
  const lines = useMemo(
    () =>
      buildHeaderLines({
        model,
        mood,
        messageCount,
        themeName,
        approximateTokens,
        latencyMs,
        fallbackModel,
        status,
        compact,
        notice,
        width,
      }),
    [
      approximateTokens,
      compact,
      fallbackModel,
      latencyMs,
      messageCount,
      model,
      mood,
      notice,
      status,
      themeName,
      width,
    ],
  );

  if (width < FRAMED_MIN_WIDTH) {
    return (
      <Box width={width} marginBottom={marginBottom}>
        <Text color={statusColor[status]} wrap="truncate">
          {tinyLine({ model, messageCount, status, width })}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} marginBottom={marginBottom}>
      <Text color={t.primaryDim}>{lines[0]}</Text>
      <Text color={statusColor[status]}>{lines[1]}</Text>
      {lines.slice(2, -1).map((line, index) => (
        <Text key={index} color={index === 0 ? t.primaryLight : t.dim}>
          {line}
        </Text>
      ))}
      <Text color={t.primaryDim}>{lines[lines.length - 1]}</Text>
    </Box>
  );
}

export const DealDeskHeader = memo(DealDeskHeaderInner);
