import { Box, Text } from "ink";
import { APOLLO_DIM, DIM_COLOR } from "./colors.ts";

interface Props {
  messageCount: number;
  witticism: string;
  maxWidth?: number;
}

const MAX_WITTICISM_LEN = 60;

export function StatusBar({ messageCount, witticism, maxWidth }: Props) {
  const safe =
    witticism.length > MAX_WITTICISM_LEN
      ? witticism.slice(0, MAX_WITTICISM_LEN - 1) + "…"
      : witticism;
  const box = (
    <Box>
      <Text color={DIM_COLOR}>
        {messageCount} message{messageCount === 1 ? "" : "s"}
      </Text>
      <Text color={APOLLO_DIM}>{"  │  "}</Text>
      <Text color={DIM_COLOR} italic>
        "{safe}"
      </Text>
    </Box>
  );
  if (typeof maxWidth === "number") {
    return <Box width={maxWidth}>{box}</Box>;
  }
  return box;
}
