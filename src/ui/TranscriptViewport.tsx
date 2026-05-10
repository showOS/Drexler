import { Box, Text } from "ink";
import { Children, memo, useMemo, type ReactNode } from "react";
import { displayWidth, fitDisplayText, splitGraphemes } from "./graphemes.ts";
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

const ROLE_MARKERS: Record<TranscriptViewportItem["role"], string> = {
  user: "›",
  assistant: "│",
  system: "!",
};

function wrapDisplayLine(input: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  if (input.length === 0) return [""];
  if (displayWidth(input) <= width) return [input];

  const parts = splitGraphemes(input);
  const rows: string[] = [];
  let current = "";
  let lastBreakAt = -1;

  for (const part of parts) {
    const next = `${current}${part}`;
    if (displayWidth(next) <= width) {
      current = next;
      if (/\s/u.test(part)) lastBreakAt = current.length;
      continue;
    }

    if (lastBreakAt > 0) {
      const head = current.slice(0, lastBreakAt).trimEnd();
      const tail = current.slice(lastBreakAt).trimStart();
      rows.push(head);
      current = `${tail}${part}`;
    } else {
      if (current.length > 0) rows.push(current);
      current = part;
    }
    lastBreakAt = /\s/u.test(part) ? current.length : -1;

    while (displayWidth(current) > width) {
      let clipped = "";
      for (const grapheme of splitGraphemes(current)) {
        if (displayWidth(`${clipped}${grapheme}`) > width) break;
        clipped += grapheme;
      }
      if (clipped.length === 0) {
        const [first = ""] = splitGraphemes(current);
        rows.push(fitDisplayText(first, width));
        current = current.slice(first.length);
        continue;
      }
      rows.push(clipped);
      current = current.slice(clipped.length);
    }
  }

  rows.push(current.trimEnd());
  return rows.filter((row, index) => row.length > 0 || index === 0);
}

function wrappedContentRows(content: string, width: number): string[] {
  return content
    .split("\n")
    .flatMap((line) => wrapDisplayLine(line, width));
}

function itemRows(
  item: TranscriptViewportItem,
  compact: boolean,
  cols: number,
): number {
  if (compact) return 1;
  const bodyPrefix = `${ROLE_MARKERS[item.role]}  `;
  const contentWidth = Math.max(1, cols - displayWidth(bodyPrefix));
  return 2 + wrappedContentRows(item.content, contentWidth).length;
}

function roleAccentColor(
  role: TranscriptViewportItem["role"],
  theme: ReturnType<typeof useTheme>,
): string {
  if (role === "system") return theme.warning;
  if (role === "user") return theme.warning;
  return theme.primaryLight;
}

function roleBodyColor(
  role: TranscriptViewportItem["role"],
  theme: ReturnType<typeof useTheme>,
): string {
  if (role === "system") return theme.dim;
  return theme.text;
}

function rule(char: string, width: number): string {
  return char.repeat(Math.max(0, width));
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
  const accent = roleAccentColor(item.role, t);

  if (compact) {
    const marker = item.role === "assistant" ? "◆" : ROLE_MARKERS[item.role];
    const prefix = `${label} ${marker} `;
    const budget = Math.max(1, cols - displayWidth(prefix));
    const firstLine = item.content.split("\n")[0] ?? "";
    return (
      <Box width={cols} flexShrink={1}>
        <Text color={accent} bold>
          {fitDisplayText(prefix, cols)}
        </Text>
        {displayWidth(prefix) < cols ? (
          <Text color={roleBodyColor(item.role, t)} wrap="truncate">
            {fitDisplayText(firstLine, budget)}
          </Text>
        ) : null}
      </Box>
    );
  }

  const headerPrefix = `╭─ ${label} `;
  const headerRuleWidth = Math.max(0, cols - displayWidth(headerPrefix));
  const footerWidth = Math.max(1, cols - 1);
  const bodyPrefix = `${ROLE_MARKERS[item.role]}  `;
  const contentWidth = Math.max(1, cols - displayWidth(bodyPrefix));

  return (
    <Box flexDirection="column" width={cols} flexShrink={1}>
      <Text color={accent} bold wrap="truncate">
        {fitDisplayText(
          `${headerPrefix}${rule("─", headerRuleWidth)}`,
          cols,
        )}
      </Text>
      {wrappedContentRows(item.content, contentWidth).map((line, index) => (
        <Box key={index} width={cols} flexShrink={1}>
          <Text color={accent} bold={item.role === "user"}>
            {index === 0 || item.role === "assistant" ? bodyPrefix : "   "}
          </Text>
          <Text color={roleBodyColor(item.role, t)}>
            {line}
          </Text>
        </Box>
      ))}
      <Text color={accent} bold={item.role === "user"} wrap="truncate">
        {fitDisplayText(`╰${rule("─", footerWidth)}`, cols)}
      </Text>
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
    estimatedRows: itemRows(item, compact, cols),
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
