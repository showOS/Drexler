import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { APOLLO, DIM_COLOR } from "./colors.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Props {
  label: string;
}

export function Spinner({ label }: Props) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);

  return (
    <Box>
      <Text color={APOLLO}>{FRAMES[i]} </Text>
      <Text color={DIM_COLOR}>{label}…</Text>
    </Box>
  );
}
