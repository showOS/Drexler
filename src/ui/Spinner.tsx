import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const STAGES = [
  "pricing risk",
  "checking covenants",
  "marking comps",
  "drafting memo",
  "tightening language",
];

interface Props {
  label: string;
  width?: number;
}

export function Spinner({ label, width = 80 }: Props) {
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
  const stage = STAGES[Math.floor(elapsedMs / 1600) % STAGES.length]!;
  const safeWidth = Math.max(1, Math.floor(width));
  const elapsedLabel = seconds > 0 ? ` · ${seconds}s` : "";
  const detail = `${label} · ${stage}${elapsedLabel}`;

  if (safeWidth < 24) {
    return (
      <Box width={safeWidth} flexShrink={1}>
        <Text color={t.primaryLight} wrap="truncate">
          {fitDisplayText(`${FRAMES[i]} ${detail}`, safeWidth)}
        </Text>
      </Box>
    );
  }

  const labelBudget = Math.max(1, safeWidth - 22);
  const showStage = safeWidth >= 42;

  return (
    <Box
      borderStyle="round"
      borderColor={t.primaryDim}
      paddingX={1}
      width={safeWidth}
      flexShrink={1}
    >
      <Text color={t.primaryLight}>{FRAMES[i]} </Text>
      <Text color={t.primaryLight} bold>
        WORKING
      </Text>
      <Text color={t.primaryDim}> ─ </Text>
      <Text color={t.text} wrap="truncate">
        {fitDisplayText(label, labelBudget)}
      </Text>
      {showStage ? <Text color={t.dim}> · {stage}</Text> : null}
      {seconds > 0 && safeWidth >= 34 ? (
        <>
          <Text color={t.primaryDim}> · </Text>
          <Text color={t.dim}>{seconds}s</Text>
        </>
      ) : null}
    </Box>
  );
}
