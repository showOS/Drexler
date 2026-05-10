import { Box, Text } from "ink";
import { Children, memo, useMemo, type ReactNode } from "react";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export interface TranscriptViewportItem {
  id?: string | number;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TranscriptViewportProps {
  items?: readonly TranscriptViewportItem[];
  children?: ReactNode;
  renderItem?: (item: TranscriptViewportItem, index: number) => ReactNode;
  maxRows?: number;
  cols?: number;
  compact?: boolean;
  scrollOffset?: number;
}

interface TranscriptEntry {
  key: string;
  node: ReactNode;
  estimatedRows: number;
}

const DEFAULT_MAX_ROWS = 18;
const DEFAULT_COLS = 80;
const MIN_COLS = 1;

const ROLE_LABELS: Record<TranscriptViewportItem["role"], string> = {
  user: "YOU",
  assistant: "DREXLER",
  system: "SYSTEM",
};

function lineCount(input: string): number {
  if (input.length === 0) return 1;
  return input.split("\n").length;
}

function itemRows(item: TranscriptViewportItem, compact: boolean): number {
  if (compact) return 1;
  return 1 + lineCount(item.content);
}

function roleColor(
  role: TranscriptViewportItem["role"],
  theme: ReturnType<typeof useTheme>,
): string {
  if (role === "system") return theme.warning;
  return theme.primaryLight;
}

function DefaultTranscriptItem({
  item,
  compact,
  cols,
}: {
  item: TranscriptViewportItem;
  compact: boolean;
  cols: number;
}) {
  const t = useTheme();
  const label = ROLE_LABELS[item.role];

  if (compact) {
    const prefix = `${label} │ `;
    const budget = Math.max(1, cols - displayWidth(prefix));
    const firstLine = item.content.split("\n")[0] ?? "";
    return (
      <Box width={cols} flexShrink={1}>
        <Text color={roleColor(item.role, t)} bold>
          {fitDisplayText(prefix, cols)}
        </Text>
        {displayWidth(prefix) < cols ? (
          <Text color={item.role === "system" ? t.dim : t.text} wrap="truncate">
            {fitDisplayText(firstLine, budget)}
          </Text>
        ) : null}
      </Box>
    );
  }

  const contentWidth = Math.max(1, cols - 2);
  return (
    <Box flexDirection="column" width={cols} flexShrink={1}>
      <Text color={roleColor(item.role, t)} bold wrap="truncate">
        {fitDisplayText(label, cols)}
      </Text>
      {item.content.split("\n").map((line, index) => (
        <Box key={index} paddingLeft={1} width={cols} flexShrink={1}>
          <Text color={t.primaryDim}>│ </Text>
          <Text color={item.role === "system" ? t.dim : t.text} wrap="truncate">
            {fitDisplayText(line, contentWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function childrenToEntries(children: ReactNode): TranscriptEntry[] {
  return Children.toArray(children).map((child, index) => ({
    key: `child-${index}`,
    node: child,
    estimatedRows: 1,
  }));
}

function itemsToEntries({
  items,
  renderItem,
  compact,
  cols,
}: {
  items: readonly TranscriptViewportItem[];
  renderItem?: (item: TranscriptViewportItem, index: number) => ReactNode;
  compact: boolean;
  cols: number;
}): TranscriptEntry[] {
  return items.map((item, index) => ({
    key: String(item.id ?? index),
    node: renderItem ? (
      renderItem(item, index)
    ) : (
      <DefaultTranscriptItem item={item} compact={compact} cols={cols} />
    ),
    estimatedRows: itemRows(item, compact),
  }));
}

function selectWindow(
  entries: TranscriptEntry[],
  maxRows: number,
  scrollOffset: number,
): {
  visible: TranscriptEntry[];
  hiddenBefore: number;
  hiddenAfter: number;
} {
  if (entries.length === 0) {
    return { visible: [], hiddenBefore: 0, hiddenAfter: 0 };
  }

  const safeRows = Math.max(1, Math.floor(maxRows));
  const safeOffset = Math.max(0, Math.min(Math.floor(scrollOffset), entries.length - 1));
  const end = entries.length - safeOffset;
  let reserveTop = 0;
  const reserveBottom = safeOffset > 0 ? 1 : 0;
  let start = Math.max(0, end - 1);

  for (let pass = 0; pass < 3; pass++) {
    const budget = Math.max(1, safeRows - reserveTop - reserveBottom);
    let used = 0;
    start = end;

    while (start > 0) {
      const entry = entries[start - 1]!;
      const rows = Math.max(1, entry.estimatedRows);
      if (used > 0 && used + rows > budget) break;
      start -= 1;
      used += rows;
      if (used >= budget) break;
    }

    const nextReserveTop = start > 0 ? 1 : 0;
    if (nextReserveTop === reserveTop) break;
    reserveTop = nextReserveTop;
  }

  return {
    visible: entries.slice(start, end),
    hiddenBefore: start,
    hiddenAfter: entries.length - end,
  };
}

function ScrollIndicator({
  direction,
  count,
  compact,
  cols,
}: {
  direction: "earlier" | "newer";
  count: number;
  compact: boolean;
  cols: number;
}) {
  const t = useTheme();
  const arrow = direction === "earlier" ? "↑" : "↓";
  const label = compact
    ? `${arrow} ${count} ${direction}`
    : `${arrow} ${count} ${direction} transcript item${count === 1 ? "" : "s"} hidden`;

  return (
    <Box width={cols} flexShrink={1}>
      <Text color={t.primaryDim} wrap="truncate">
        {fitDisplayText(label, cols)}
      </Text>
    </Box>
  );
}

function TranscriptViewportInner({
  items,
  children,
  renderItem,
  maxRows = DEFAULT_MAX_ROWS,
  cols = DEFAULT_COLS,
  compact = false,
  scrollOffset = 0,
}: TranscriptViewportProps) {
  const width = Math.max(MIN_COLS, Math.floor(cols));
  const entries = useMemo(
    () =>
      items
        ? itemsToEntries({ items, renderItem, compact, cols: width })
        : childrenToEntries(children),
    [children, compact, items, renderItem, width],
  );
  const { visible, hiddenBefore, hiddenAfter } = useMemo(
    () => selectWindow(entries, maxRows, scrollOffset),
    [entries, maxRows, scrollOffset],
  );

  return (
    <Box flexDirection="column" width={width} flexShrink={1}>
      {hiddenBefore > 0 ? (
        <ScrollIndicator
          direction="earlier"
          count={hiddenBefore}
          compact={compact}
          cols={width}
        />
      ) : null}
      {visible.map((entry) => (
        <Box key={entry.key} flexDirection="column" width={width} flexShrink={1}>
          {entry.node}
        </Box>
      ))}
      {hiddenAfter > 0 ? (
        <ScrollIndicator
          direction="newer"
          count={hiddenAfter}
          compact={compact}
          cols={width}
        />
      ) : null}
    </Box>
  );
}

export const TranscriptViewport = memo(TranscriptViewportInner);
