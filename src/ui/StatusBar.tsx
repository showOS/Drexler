import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export type StatusDot = "idle" | "streaming" | "error";

interface Props {
  messageCount: number;
  witticism: string;
  maxWidth?: number;
  status?: StatusDot;
  compact?: boolean;
  scrollHint?: string;
  tokenCount?: number;
}

const MAX_WITTICISM_LEN = 60;
const STATUS_BAR_PROMPT_INDENT = 2;

function formatTokens(n: number): string {
  if (n < 1000) return `~${n} tok`;
  return `~${(n / 1000).toFixed(1)}k tok`;
}

function StatusBarInner({
  messageCount,
  witticism,
  maxWidth,
  status = "idle",
  compact = false,
  scrollHint,
  tokenCount,
}: Props) {
  const t = useTheme();
  const dotColor = useMemo<Record<StatusDot, string>>(
    () => ({
      idle: t.primaryLight,
      streaming: t.warning,
      error: t.error,
    }),
    [t.primaryLight, t.warning, t.error],
  );
  const safeWidth = typeof maxWidth === "number" ? Math.max(1, Math.floor(maxWidth)) : undefined;
  const countLabel = `${messageCount} message${messageCount === 1 ? "" : "s"}`;
  const quote = `"${fitDisplayText(witticism, MAX_WITTICISM_LEN)}"`;
  const tokenLabel =
    typeof tokenCount === "number" && tokenCount >= 0 && !compact
      ? `  │  ${formatTokens(tokenCount)}`
      : "";
  const line = compact
    ? `${countLabel}${scrollHint ? `  │  ${scrollHint}` : ""}`
    : `${countLabel}${scrollHint ? `  │  ${scrollHint}` : ""}${tokenLabel}  │  ${quote}`;
  const leadingIndent =
    typeof safeWidth === "number"
      ? Math.min(STATUS_BAR_PROMPT_INDENT, Math.max(0, safeWidth - 1))
      : STATUS_BAR_PROMPT_INDENT;
  const body = fitDisplayText(line, Math.max(1, (safeWidth ?? 80) - 2 - leadingIndent));
  const box = compact ? (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim} wrap="truncate">
        {body}
      </Text>
    </Box>
  ) : (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim} italic wrap="truncate">
        {body}
      </Text>
    </Box>
  );
  if (typeof safeWidth === "number") {
    return (
      <Box width={safeWidth} paddingLeft={leadingIndent}>
        {box}
      </Box>
    );
  }
  return <Box paddingLeft={leadingIndent}>{box}</Box>;
}

export const StatusBar = memo(StatusBarInner);
