import { Box, Text } from "ink";
import { memo, useEffect, useState } from "react";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
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

function SpinnerInner({ label, width = 80 }: Props) {
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

  const innerWidth = Math.max(1, safeWidth - 4);
  const showStage = safeWidth >= 42;
  const stageLabel = showStage ? ` · ${stage}` : "";
  const secondsLabel = seconds > 0 && safeWidth >= 34 ? ` · ${seconds}s` : "";
  const fixedWidth =
    displayWidth(`${FRAMES[i]} WORKING ─ `) +
    displayWidth(stageLabel) +
    displayWidth(secondsLabel);
  const labelBudget = Math.max(1, innerWidth - fixedWidth);

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
      {stageLabel ? <Text color={t.dim}>{stageLabel}</Text> : null}
      {secondsLabel ? <Text color={t.dim}>{secondsLabel}</Text> : null}
    </Box>
  );
}


export const Spinner = memo(SpinnerInner);
