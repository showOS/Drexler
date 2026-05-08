import { Box, Text } from "ink";
import { useMemo } from "react";
import type { SlashCommand } from "../commands.ts";
import { useTheme } from "./ThemeContext.tsx";

interface Props {
  items: ReadonlyArray<SlashCommand>;
  selectedIdx: number;
}

export function CommandPalette({ items, selectedIdx }: Props) {
  const t = useTheme();
  const maxNameW = useMemo(
    () => items.reduce((m, i) => Math.max(m, i.name.length), 0),
    [items],
  );
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      {items.map((item, idx) => {
        const sel = idx === selectedIdx;
        return (
          <Box key={item.name}>
            <Text color={sel ? t.primaryLight : t.primary} bold={sel}>
              {sel ? "❯ " : "  "}
            </Text>
            <Text color={sel ? t.primaryLight : t.primary} bold={sel}>
              {item.name.padEnd(maxNameW + 2)}
            </Text>
            <Text color={t.dim}>{item.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
