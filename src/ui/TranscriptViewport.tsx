import { Box, Text } from "ink";
import { Children, memo, useMemo, type ReactNode } from "react";
import {
  assistantDisplayLines,
  firstDisplayLine,
  normalizeAssistantDisplayContent,
  type AssistantDisplayLine,
} from "./displayContent.ts";
import { displayWidth, fitDisplayText, graphemeWidth, splitGraphemes } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

export interface TranscriptViewportItem {
  readonly id?: string | number;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
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
  node: ReactNode | ((clipTo?: { readonly start: number; readonly rows: number }) => ReactNode);
  estimatedRows: number;
}

interface VisibleEntry {
  entry: TranscriptEntry;
  clipStart?: number;
  clipRows?: number;
}

const DEFAULT_MAX_ROWS = 18;
const DEFAULT_COLS = 80;
const MIN_COLS = 1;
const HEADER_FOOTER_ROWS = 2;
const TRUNCATION_HINT_ROWS = 1;
const MIN_TRUNCATED_BODY_ROWS = 1;

function truncationHint(dropped: number, direction: "earlier" | "newer"): string {
  const keyHint = direction === "earlier" ? "PageUp scrollback" : "PageDown newer";
  return `... ${dropped} line${dropped === 1 ? "" : "s"} ${direction} — ${keyHint} to read`;
}

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

const BODY_SUFFIX = " │";
const CONTINUATION_PREFIX = "│   ";
const CODE_GUTTER = "┃ ";
const DRACULA_CODE = {
  text: "#f8f8f2",
  keyword: "#ff79c6",
  function: "#50fa7b",
  string: "#f1fa8c",
  number: "#bd93f9",
  comment: "#6272a4",
  operator: "#8be9fd",
  gutter: "#6272a4",
};

interface WrappedTranscriptLine {
  kind: AssistantDisplayLine["kind"];
  text: string;
  language?: string;
}

interface CodeToken {
  kind: "plain" | "keyword" | "function" | "string" | "number" | "comment" | "operator";
  text: string;
}

const CODE_KEYWORDS = new Set([
  "and",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "do",
  "elif",
  "else",
  "except",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "none",
  "not",
  "null",
  "or",
  "pass",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "var",
  "while",
  "with",
  "yield",
]);

const CODE_OPERATOR_RE = /^[()[\]{}.,:;+\-*/%=<>!&|^~?]+/u;
const CODE_NUMBER_RE = /^\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/iu;
const CODE_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*/u;

function bodyPrefixForRole(role: TranscriptViewportItem["role"]): string {
  if (role === "user") return "│ › ";
  if (role === "assistant") return "│ ◆ ";
  return CONTINUATION_PREFIX;
}

function transcriptContentWidth(role: TranscriptViewportItem["role"], cols: number): number {
  return Math.max(1, cols - displayWidth(bodyPrefixForRole(role)) - displayWidth(BODY_SUFFIX));
}

function wrapDisplayLine(input: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  if (input.length === 0) return [""];
  if (displayWidth(input) <= width) return [input];

  const parts = splitGraphemes(input);
  const widths = parts.map((part) => graphemeWidth(part));
  const isSpace = parts.map((part) => /\s/u.test(part));
  const rows: string[] = [];

  // [start, end) is the index range currently held in "current"; sumWidth caches its width.
  let start = 0;
  let end = 0;
  let sumWidth = 0;
  let lastBreakAt = -1;

  const sliceWidth = (from: number, to: number): number => {
    let w = 0;
    for (let j = from; j < to; j += 1) w += widths[j] ?? 0;
    return w;
  };

  for (let i = 0; i < parts.length; i += 1) {
    const w = widths[i] ?? 0;
    if (sumWidth + w <= width) {
      end = i + 1;
      sumWidth += w;
      if (isSpace[i]) lastBreakAt = end;
      continue;
    }

    if (lastBreakAt > start) {
      rows.push(parts.slice(start, lastBreakAt).join("").trimEnd());
      let tailStart = lastBreakAt;
      while (tailStart < end && isSpace[tailStart]) tailStart += 1;
      start = tailStart;
      end = i + 1;
      sumWidth = sliceWidth(start, end);
    } else {
      if (end > start) rows.push(parts.slice(start, end).join(""));
      start = i;
      end = i + 1;
      sumWidth = w;
    }
    lastBreakAt = isSpace[i] ? end : -1;

    while (sumWidth > width) {
      let clippedEnd = start;
      let clippedWidth = 0;
      for (let j = start; j < end; j += 1) {
        const gw = widths[j] ?? 0;
        if (clippedWidth + gw > width) break;
        clippedWidth += gw;
        clippedEnd = j + 1;
      }
      if (clippedEnd === start) {
        rows.push(fitDisplayText(parts[start] ?? "", width));
        sumWidth -= widths[start] ?? 0;
        start += 1;
        continue;
      }
      rows.push(parts.slice(start, clippedEnd).join(""));
      sumWidth -= clippedWidth;
      start = clippedEnd;
    }
  }

  rows.push(parts.slice(start, end).join("").trimEnd());
  return rows.filter((row, index) => row.length > 0 || index === 0);
}

function displayContentForItem(item: TranscriptViewportItem): string {
  if (item.role !== "assistant") return item.content;
  return normalizeAssistantDisplayContent(item.content);
}

function displayLinesForItem(item: TranscriptViewportItem): AssistantDisplayLine[] {
  const lines =
    item.role === "assistant"
      ? assistantDisplayLines(item.content)
      : item.content.split("\n").map((text) => ({ kind: "text" as const, text }));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.text.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]?.text.trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

// Per-item wrap cache. Keyed on the ChatItem object reference (identity-stable
// across renders — App.tsx only appends new ChatItem objects, never mutates
// existing ones, so a settled item's wrap output is a pure function of
// (role, contentWidth)). WeakMap auto-evicts when the item is dropped from
// the transcript array and GC'd. Inner Map is LRU-bounded so a long
// session of terminal resizes does not grow the per-item cache without
// limit.
const MAX_WIDTHS_PER_ITEM = 4;
interface TranscriptItemCache {
  role: TranscriptViewportItem["role"];
  content: string;
  wraps: Map<string, WrappedTranscriptLine[]>;
  rows: Map<string, number>;
}

const itemCache = new WeakMap<TranscriptViewportItem, TranscriptItemCache>();

function cacheForItem(item: TranscriptViewportItem): TranscriptItemCache {
  const existing = itemCache.get(item);
  if (existing !== undefined && existing.role === item.role && existing.content === item.content) {
    return existing;
  }

  const fresh: TranscriptItemCache = {
    role: item.role,
    content: item.content,
    wraps: new Map(),
    rows: new Map(),
  };
  itemCache.set(item, fresh);
  return fresh;
}

function lruGet<V>(map: Map<string, V>, key: string): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  // Bump to most-recently-used: delete + re-insert moves to tail of insertion order.
  map.delete(key);
  map.set(key, value);
  return value;
}

function lruSet<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value);
  if (map.size > MAX_WIDTHS_PER_ITEM) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function computeWrappedTranscriptLines(
  item: TranscriptViewportItem,
  contentWidth: number,
): WrappedTranscriptLine[] {
  return displayLinesForItem(item).flatMap((line) => {
    const width =
      line.kind === "code" ? Math.max(1, contentWidth - displayWidth(CODE_GUTTER)) : contentWidth;
    return wrapDisplayLine(line.text, width).map((text) => ({
      kind: line.kind,
      text,
      language: line.language,
    }));
  });
}

export function wrappedTranscriptLines(
  item: TranscriptViewportItem,
  contentWidth: number,
): WrappedTranscriptLine[] {
  // Key includes role for safety even though it is encoded in contentWidth
  // (different roles have different body prefixes → different content widths).
  // Including it explicitly avoids any chance of collision if two roles ever
  // happen to produce the same contentWidth for a given cols.
  const innerKey = `${item.role}|${contentWidth}`;
  const perItem = cacheForItem(item).wraps;
  const cached = lruGet(perItem, innerKey);
  if (cached !== undefined) return cached;
  const computed = computeWrappedTranscriptLines(item, contentWidth);
  lruSet(perItem, innerKey, computed);
  return computed;
}

function tokenizeCodeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let rest = line;

  while (rest.length > 0) {
    const comment = rest.startsWith("#") || rest.startsWith("//") ? rest : undefined;
    if (comment !== undefined) {
      tokens.push({ kind: "comment", text: comment });
      break;
    }

    const stringQuote = rest[0];
    if (stringQuote === '"' || stringQuote === "'" || stringQuote === "`") {
      let end = 1;
      let escaped = false;
      while (end < rest.length) {
        const char = rest[end];
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === stringQuote) {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push({ kind: "string", text: rest.slice(0, end) });
      rest = rest.slice(end);
      continue;
    }

    const number = CODE_NUMBER_RE.exec(rest)?.[0];
    if (number) {
      tokens.push({ kind: "number", text: number });
      rest = rest.slice(number.length);
      continue;
    }

    const identifier = CODE_IDENTIFIER_RE.exec(rest)?.[0];
    if (identifier) {
      const after = rest.slice(identifier.length);
      const kind = CODE_KEYWORDS.has(identifier.toLowerCase())
        ? "keyword"
        : /^\s*\(/u.test(after)
          ? "function"
          : "plain";
      tokens.push({ kind, text: identifier });
      rest = rest.slice(identifier.length);
      continue;
    }

    const operator = CODE_OPERATOR_RE.exec(rest)?.[0];
    if (operator) {
      tokens.push({ kind: "operator", text: operator });
      rest = rest.slice(operator.length);
      continue;
    }

    tokens.push({ kind: "plain", text: rest[0]! });
    rest = rest.slice(1);
  }

  return tokens;
}

export function estimateTranscriptRows(
  items: readonly TranscriptViewportItem[],
  compact: boolean,
  cols: number,
): number {
  return items.reduce((sum, item) => sum + getCachedItemRows(item, compact, cols), 0);
}

function itemRows(item: TranscriptViewportItem, compact: boolean, cols: number): number {
  if (compact) return 1;
  const contentWidth = transcriptContentWidth(item.role, cols);
  return 2 + wrappedTranscriptLines(item, contentWidth).length;
}

function getCachedItemRows(item: TranscriptViewportItem, compact: boolean, cols: number): number {
  const cache = cacheForItem(item).rows;

  const key = `${compact ? "c" : "f"}-${cols}`;
  const cached = lruGet(cache, key);
  if (cached !== undefined) return cached;

  const rows = itemRows(item, compact, cols);
  lruSet(cache, key, rows);
  return rows;
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

const DefaultTranscriptItem = memo(function DefaultTranscriptItem({
  item,
  compact,
  cols,
  clipStart = 0,
  maxRows,
}: {
  item: TranscriptViewportItem;
  compact: boolean;
  cols: number;
  clipStart?: number;
  maxRows?: number;
}) {
  const t = useTheme();
  const label = ROLE_LABELS[item.role];
  const accent = roleAccentColor(item.role, t);
  const renderCodeLine = (line: string) =>
    tokenizeCodeLine(line).map((token, tokenIndex) => {
      const color =
        token.kind === "keyword"
          ? DRACULA_CODE.keyword
          : token.kind === "function"
            ? DRACULA_CODE.function
            : token.kind === "string"
              ? DRACULA_CODE.string
              : token.kind === "number" || token.kind === "operator"
                ? token.kind === "number"
                  ? DRACULA_CODE.number
                  : DRACULA_CODE.operator
                : token.kind === "comment"
                  ? DRACULA_CODE.comment
                  : DRACULA_CODE.text;
      return (
        <Text
          key={tokenIndex}
          color={color}
          bold={token.kind === "keyword" || token.kind === "function"}
          italic={token.kind === "comment"}
        >
          {token.text}
        </Text>
      );
    });

  if (compact || (maxRows !== undefined && maxRows < HEADER_FOOTER_ROWS + 1)) {
    const marker = item.role === "assistant" ? "◆" : ROLE_MARKERS[item.role];
    const prefix = `${label} ${marker} `;
    const budget = Math.max(1, cols - displayWidth(prefix));
    const firstLine = firstDisplayLine(displayContentForItem(item));
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
  const headerRuleWidth = Math.max(0, cols - displayWidth(headerPrefix) - 1);
  const footerWidth = Math.max(0, cols - 2);
  const bodyPrefix = bodyPrefixForRole(item.role);
  const contentWidth = transcriptContentWidth(item.role, cols);
  const allDisplayLines = wrappedTranscriptLines(item, contentWidth);
  let displayLines: WrappedTranscriptLine[] = allDisplayLines;
  if (maxRows !== undefined) {
    const bodyBudget = Math.max(MIN_TRUNCATED_BODY_ROWS, maxRows - HEADER_FOOTER_ROWS);
    const bodyStart = Math.max(0, Math.min(allDisplayLines.length, clipStart - 1));
    const before = bodyStart;
    const afterAvailable = Math.max(0, allDisplayLines.length - bodyStart);
    const needsTopHint = before > 0;
    const needsBottomHint = afterAvailable > bodyBudget;
    const hintRows =
      (needsTopHint ? TRUNCATION_HINT_ROWS : 0) + (needsBottomHint ? TRUNCATION_HINT_ROWS : 0);
    const keep = Math.max(0, bodyBudget - hintRows);
    const bodyEnd = Math.min(allDisplayLines.length, bodyStart + keep);
    if (needsTopHint || bodyEnd < allDisplayLines.length) {
      const droppedBefore = before;
      const droppedAfter = allDisplayLines.length - bodyEnd;
      displayLines = [
        ...(droppedBefore > 0
          ? [
              {
                kind: "text" as const,
                text: truncationHint(droppedBefore, "earlier"),
              },
            ]
          : []),
        ...allDisplayLines.slice(bodyStart, bodyEnd),
        ...(droppedAfter > 0
          ? [
              {
                kind: "text" as const,
                text: truncationHint(droppedAfter, "newer"),
              },
            ]
          : []),
      ];
    }
  }

  return (
    <Box flexDirection="column" width={cols} flexShrink={1}>
      <Text color={accent} bold wrap="truncate">
        {fitDisplayText(`${headerPrefix}${rule("─", headerRuleWidth)}╮`, cols)}
      </Text>
      {displayLines.map((line, index) => (
        <Box key={index} width={cols} flexShrink={1}>
          <Text color={accent} bold={item.role === "user"}>
            {index === 0 ? bodyPrefix : CONTINUATION_PREFIX}
          </Text>
          {line.kind === "code" ? <Text color={DRACULA_CODE.gutter}>{CODE_GUTTER}</Text> : null}
          <Text color={line.kind === "code" ? DRACULA_CODE.text : roleBodyColor(item.role, t)}>
            {line.kind === "code"
              ? renderCodeLine(
                  fitDisplayText(line.text, Math.max(1, contentWidth - displayWidth(CODE_GUTTER))),
                )
              : fitDisplayText(line.text, contentWidth)}
          </Text>
          <Text color={accent} bold={item.role === "user"}>
            {`${" ".repeat(
              Math.max(
                0,
                contentWidth -
                  displayWidth(line.text) -
                  (line.kind === "code" ? displayWidth(CODE_GUTTER) : 0),
              ),
            )}${BODY_SUFFIX}`}
          </Text>
        </Box>
      ))}
      <Text color={accent} bold={item.role === "user"} wrap="truncate">
        {fitDisplayText(`╰${rule("─", footerWidth)}╯`, cols)}
      </Text>
    </Box>
  );
});

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
    node: renderItem
      ? renderItem(item, index)
      : (clipTo?: { readonly start: number; readonly rows: number }) => (
          <DefaultTranscriptItem
            item={item}
            compact={compact}
            cols={cols}
            clipStart={clipTo?.start}
            maxRows={clipTo?.rows}
          />
        ),
    estimatedRows: getCachedItemRows(item, compact, cols),
  }));
}

function selectWindow(
  entries: TranscriptEntry[],
  maxRows: number,
  scrollOffset: number,
): {
  visible: VisibleEntry[];
  hiddenBefore: number;
  hiddenAfter: number;
  hiddenRowsBefore: number;
  hiddenRowsAfter: number;
} {
  if (entries.length === 0) {
    return {
      visible: [],
      hiddenBefore: 0,
      hiddenAfter: 0,
      hiddenRowsBefore: 0,
      hiddenRowsAfter: 0,
    };
  }

  const safeRows = Math.max(1, Math.floor(maxRows));
  const rowCounts = entries.map((entry) => Math.max(1, entry.estimatedRows));
  const totalRows = rowCounts.reduce((sum, rows) => sum + rows, 0);
  const maxOffset = Math.max(0, totalRows - 1);
  const safeOffset = Math.max(0, Math.min(Math.floor(scrollOffset), maxOffset));
  const endRow = Math.max(1, totalRows - safeOffset);
  let indicatorRows = 0;
  let startRow = Math.max(0, endRow - safeRows);

  for (let pass = 0; pass < 3; pass++) {
    const hiddenBeforeRows = startRow;
    const hiddenAfterRows = Math.max(0, totalRows - endRow);
    const nextIndicatorRows = Math.min(
      safeRows - 1,
      (hiddenBeforeRows > 0 ? 1 : 0) + (hiddenAfterRows > 0 ? 1 : 0),
    );
    if (nextIndicatorRows === indicatorRows) break;
    indicatorRows = nextIndicatorRows;
    startRow = Math.max(0, endRow - Math.max(1, safeRows - indicatorRows));
  }

  const buildVisible = (fromRow: number, toRow: number): VisibleEntry[] => {
    const next: VisibleEntry[] = [];
    let rowCursor = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const rows = rowCounts[i]!;
      const entryStart = rowCursor;
      const entryEnd = rowCursor + rows;
      rowCursor = entryEnd;
      const overlapStart = Math.max(fromRow, entryStart);
      const overlapEnd = Math.min(toRow, entryEnd);
      if (overlapStart >= overlapEnd) continue;
      next.push({
        entry,
        clipStart: overlapStart - entryStart,
        clipRows: overlapEnd - overlapStart,
      });
    }
    return next;
  };

  let visible = buildVisible(startRow, endRow);
  if (
    indicatorRows > 0 &&
    visible.some(
      ({ entry, clipRows }) =>
        entry.estimatedRows >= HEADER_FOOTER_ROWS + MIN_TRUNCATED_BODY_ROWS &&
        (clipRows ?? entry.estimatedRows) < HEADER_FOOTER_ROWS + MIN_TRUNCATED_BODY_ROWS,
    )
  ) {
    indicatorRows = 0;
    startRow = Math.max(0, endRow - safeRows);
    visible = buildVisible(startRow, endRow);
  }

  let hiddenBefore = 0;
  let hiddenAfter = 0;
  let cursor = 0;
  for (let i = 0; i < entries.length; i++) {
    const rows = rowCounts[i]!;
    const entryStart = cursor;
    const entryEnd = cursor + rows;
    cursor = entryEnd;
    if (entryEnd <= startRow) hiddenBefore += 1;
    else if (entryStart < startRow && entryEnd > startRow) hiddenBefore += 1;
    if (entryStart >= endRow) hiddenAfter += 1;
    else if (entryStart < endRow && entryEnd > endRow) hiddenAfter += 1;
  }
  let hiddenRowsBefore = startRow;
  let hiddenRowsAfter = Math.max(0, totalRows - endRow);
  const showTopIndicator = indicatorRows > 0 && hiddenRowsBefore > 0;
  const showBottomIndicator = indicatorRows > (showTopIndicator ? 1 : 0) && hiddenRowsAfter > 0;
  if (!showTopIndicator) {
    hiddenBefore = 0;
    hiddenRowsBefore = 0;
  }
  if (!showBottomIndicator) {
    hiddenAfter = 0;
    hiddenRowsAfter = 0;
  }

  return {
    visible,
    hiddenBefore,
    hiddenAfter,
    hiddenRowsBefore,
    hiddenRowsAfter,
  };
}

function ScrollIndicator({
  direction,
  count,
  rows,
  compact,
  cols,
}: {
  direction: "earlier" | "newer";
  count: number;
  rows: number;
  compact: boolean;
  cols: number;
}) {
  const t = useTheme();
  const arrow = direction === "earlier" ? "↑" : "↓";
  const keyHint = direction === "earlier" ? "PageUp scrollback" : "PageDown newer";
  const label = compact
    ? `${arrow} ${rows} ${direction}`
    : `${arrow} ${rows} line${rows === 1 ? "" : "s"} ${direction} (${count} item${count === 1 ? "" : "s"} hidden) — ${keyHint}`;

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
  const { visible, hiddenBefore, hiddenAfter, hiddenRowsBefore, hiddenRowsAfter } = useMemo(
    () => selectWindow(entries, maxRows, scrollOffset),
    [entries, maxRows, scrollOffset],
  );

  return (
    <Box flexDirection="column" width={width} flexShrink={1}>
      {hiddenBefore > 0 ? (
        <ScrollIndicator
          direction="earlier"
          count={hiddenBefore}
          rows={hiddenRowsBefore}
          compact={compact}
          cols={width}
        />
      ) : null}
      {visible.map(({ entry, clipStart, clipRows }) => (
        <Box key={entry.key} flexDirection="column" width={width} flexShrink={1}>
          {typeof entry.node === "function"
            ? entry.node(
                clipRows === undefined ? undefined : { start: clipStart ?? 0, rows: clipRows },
              )
            : entry.node}
        </Box>
      ))}
      {hiddenAfter > 0 ? (
        <ScrollIndicator
          direction="newer"
          count={hiddenAfter}
          rows={hiddenRowsAfter}
          compact={compact}
          cols={width}
        />
      ) : null}
    </Box>
  );
}

export const TranscriptViewport = memo(TranscriptViewportInner);
