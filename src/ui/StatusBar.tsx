import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { useTheme } from "./ThemeContext.tsx";

export type StatusDot = "idle" | "streaming" | "error";

interface Props {
  messageCount: number;
  witticism: string;
  maxWidth?: number;
  status?: StatusDot;
  compact?: boolean;
}

const MAX_WITTICISM_LEN = 60;

function clampText(input: string, max: number): string {
  if (input.length <= max) return input;
  if (max <= 0) return "";
  if (max === 1) return "…";
  return input.slice(0, max - 1) + "…";
}

function StatusBarInner({
  messageCount,
  witticism,
  maxWidth,
  status = "idle",
  compact = false,
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
  const countLabel = `${messageCount} message${messageCount === 1 ? "" : "s"}`;
  const quoteWidth =
    typeof maxWidth === "number"
      ? Math.max(0, maxWidth - "● ".length - countLabel.length - "  │  ".length - 2)
      : MAX_WITTICISM_LEN;
  const safe = clampText(witticism, Math.min(MAX_WITTICISM_LEN, quoteWidth));
  const box = compact ? (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim}>{countLabel}</Text>
    </Box>
  ) : (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim}>{countLabel}</Text>
      <Text color={t.primaryDim}>{"  │  "}</Text>
      <Text color={t.dim} italic>
        "{safe}"
      </Text>
    </Box>
  );
  if (typeof maxWidth === "number") {
    return <Box width={maxWidth}>{box}</Box>;
  }
  return box;
}

export const StatusBar = memo(StatusBarInner);
