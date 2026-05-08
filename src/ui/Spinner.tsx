import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { APOLLO, APOLLO_DIM, DIM_COLOR } from "./colors.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Props {
  label: string;
}

export function Spinner({ label }: Props) {
  const [i, setI] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setI((x) => (x + 1) % FRAMES.length);
      setElapsedMs(Date.now() - start);
    }, 80);
    return () => clearInterval(t);
  }, []);

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <Box>
      <Text color={APOLLO}>{FRAMES[i]} </Text>
      <Text color={DIM_COLOR}>{label}…</Text>
      {seconds > 0 ? (
        <>
          <Text color={APOLLO_DIM}>{"  "}</Text>
          <Text color={DIM_COLOR}>{seconds}s</Text>
        </>
      ) : null}
    </Box>
  );
}
