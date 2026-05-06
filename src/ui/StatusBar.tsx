import { Box, Text } from "ink";
import React from "react";
import { APOLLO_DIM, DIM_COLOR } from "./colors.ts";

interface Props {
  messageCount: number;
  witticism: string;
}

export function StatusBar({ messageCount, witticism }: Props) {
  return (
    <Box>
      <Text color={DIM_COLOR}>
        {messageCount} message{messageCount === 1 ? "" : "s"}
      </Text>
      <Text color={APOLLO_DIM}>{"  │  "}</Text>
      <Text color={DIM_COLOR} italic>
        "{witticism}"
      </Text>
    </Box>
  );
}
