// §V70 — Bracketed-paste attach-vs-inline-vs-discard prompt.
//
// Rendered above the InputBox when App.tsx has a pending paste payload
// that tripped the size/NUL threshold. Input is locked until the user
// picks an outcome (handled in App.tsx key dispatch):
//
//   Enter   = attach as file
//   i       = insert as plain text (override caps)
//   ESC     = discard payload

import { Box, Text } from "ink";
import { useTheme } from "../ThemeContext.tsx";

interface Props {
  sizeBytes: number;
  reasons: readonly ("too_large" | "binary")[];
  width: number;
}

function describeReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return "armed by /paste";
  const parts: string[] = [];
  if (reasons.includes("too_large")) parts.push("large");
  if (reasons.includes("binary")) parts.push("binary");
  return parts.join(" + ");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function PasteIntakePrompt({ sizeBytes, reasons, width }: Props) {
  const t = useTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.primary}
      paddingX={1}
      marginBottom={1}
      width={width}
    >
      <Text color={t.primaryLight} bold>
        {`PASTE INTAKE  ·  ${fmtBytes(sizeBytes)}  ·  ${describeReasons(reasons)}`}
      </Text>
      <Text color={t.dim}>{`Enter attach · i insert as text · ESC discard`}</Text>
    </Box>
  );
}
