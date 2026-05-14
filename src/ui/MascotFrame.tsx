import { Box, Text } from "ink";
import { memo } from "react";
import { useTheme } from "./ThemeContext.tsx";

export const MASCOT_WIDTH = 17;

export const BRIEFCASE_FINAL = [
  "      ╔════╗     ",
  " ╔════╩════╩════╗",
  " ║  \\__    __/  ║",
  " ║   ◆      ◆   ║",
  " ║    ╔════╗    ║",
  " ║    ║ $$ ║    ║",
  " ╚════╩════╩════╝",
] as const;

export const BROW_LINES = {
  hidden: " ║              ║",
  raised: " ║  \\_      _/  ║",
  focused: " ║   \\__  __/   ║",
  flat: " ║  ──      ──  ║",
  normal: BRIEFCASE_FINAL[2],
} as const;

export interface MascotState {
  walls: "dim" | "on";
  brows: keyof typeof BROW_LINES;
  eyes: "hidden" | "open" | "closed";
  showLock: boolean;
  dollars: "hidden" | "on" | "dim";
}

export function renderMascotLines(p: MascotState): string[] {
  const lines: string[] = [...BRIEFCASE_FINAL];
  lines[2] = BROW_LINES[p.brows];
  lines[3] =
    p.eyes === "open"
      ? BRIEFCASE_FINAL[3]
      : p.eyes === "closed"
        ? " ║   ─      ─   ║"
        : " ║              ║";

  if (!p.showLock) {
    lines[4] = " ║              ║";
    lines[5] = " ║              ║";
  } else if (p.dollars === "dim") {
    lines[5] = " ║    ║ ░░ ║    ║";
  } else if (p.dollars === "hidden") {
    lines[5] = " ║    ║    ║    ║";
  }
  return lines;
}

function MascotFrameView(p: MascotState) {
  const t = useTheme();
  const wallColor = p.walls === "dim" ? t.primaryDim : t.primary;
  const lines = renderMascotLines(p);

  return (
    <Box flexDirection="column" width={MASCOT_WIDTH} flexShrink={0}>
      {lines.map((line, idx) => (
        <Text key={idx} color={wallColor}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

export const MascotFrame = memo(MascotFrameView);
