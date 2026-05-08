import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeContext.tsx";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Props {
  label: string;
}

export function Spinner({ label }: Props) {
  const t = useTheme();
  const [i, setI] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      setI((x) => (x + 1) % FRAMES.length);
      setElapsedMs(Date.now() - start);
    }, 80);
    return () => clearInterval(tick);
  }, []);

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <Box>
      <Text color={t.primary}>{FRAMES[i]} </Text>
      <Text color={t.dim}>{label}…</Text>
      {seconds > 0 ? (
        <>
          <Text color={t.primaryDim}>{"  "}</Text>
          <Text color={t.dim}>{seconds}s</Text>
        </>
      ) : null}
    </Box>
  );
}
