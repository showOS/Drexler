import { Box, Text } from "ink";
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

export function StatusBar({
  messageCount,
  witticism,
  maxWidth,
  status = "idle",
  compact = false,
}: Props) {
  const t = useTheme();
  const dotColor: Record<StatusDot, string> = {
    idle: t.primaryLight,
    streaming: t.warning,
    error: t.error,
  };
  const safe =
    witticism.length > MAX_WITTICISM_LEN
      ? witticism.slice(0, MAX_WITTICISM_LEN - 1) + "…"
      : witticism;
  const box = compact ? (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim}>
        {messageCount} message{messageCount === 1 ? "" : "s"}
      </Text>
    </Box>
  ) : (
    <Box>
      <Text color={dotColor[status]}>● </Text>
      <Text color={t.dim}>
        {messageCount} message{messageCount === 1 ? "" : "s"}
      </Text>
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
