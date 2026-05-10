import { Box, Text } from "ink";
import { Children, memo, useMemo, type ReactNode } from "react";
import {
  assistantDisplayLines,
  firstDisplayLine,
  normalizeAssistantDisplayContent,
  type AssistantDisplayLine,
} from "./displayContent.ts";
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
  kind:
    | "plain"
    | "keyword"
    | "function"
    | "string"
    | "number"
    | "comment"
    | "operator";
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

function transcriptContentWidth(
  role: TranscriptViewportItem["role"],
  cols: number,
): number {
  return Math.max(
    1,
    cols - displayWidth(bodyPrefixForRole(role)) - displayWidth(BODY_SUFFIX),
  );
}

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

function wrappedTranscriptLines(
  item: TranscriptViewportItem,
  contentWidth: number,
): WrappedTranscriptLine[] {
  return displayLinesForItem(item).flatMap((line) => {
    const width =
      line.kind === "code"
        ? Math.max(1, contentWidth - displayWidth(CODE_GUTTER))
        : contentWidth;
    return wrapDisplayLine(line.text, width).map((text) => ({
      kind: line.kind,
      text,
      language: line.language,
    }));
  });
}

function tokenizeCodeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let rest = line;

  while (rest.length > 0) {
    const comment =
      rest.startsWith("#") || rest.startsWith("//") ? rest : undefined;
    if (comment !== undefined) {
      tokens.push({ kind: "comment", text: comment });
      break;
    }

    const stringQuote = rest[0];
    if (stringQuote === "\"" || stringQuote === "'" || stringQuote === "`") {
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
      const kind =
        CODE_KEYWORDS.has(identifier.toLowerCase())
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

function itemRows(
  item: TranscriptViewportItem,
  compact: boolean,
  cols: number,
): number {
  if (compact) return 1;
  const contentWidth = transcriptContentWidth(item.role, cols);
  return 2 + wrappedTranscriptLines(item, contentWidth).length;
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

  if (compact) {
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
  const displayLines = wrappedTranscriptLines(item, contentWidth);

  return (
    <Box flexDirection="column" width={cols} flexShrink={1}>
      <Text color={accent} bold wrap="truncate">
        {fitDisplayText(
          `${headerPrefix}${rule("─", headerRuleWidth)}╮`,
          cols,
        )}
      </Text>
      {displayLines.map((line, index) => (
        <Box key={index} width={cols} flexShrink={1}>
          <Text color={accent} bold={item.role === "user"}>
            {index === 0 ? bodyPrefix : CONTINUATION_PREFIX}
          </Text>
          {line.kind === "code" ? (
            <Text color={DRACULA_CODE.gutter}>{CODE_GUTTER}</Text>
          ) : null}
          <Text
            color={
              line.kind === "code"
                ? DRACULA_CODE.text
                : roleBodyColor(item.role, t)
            }
          >
            {line.kind === "code"
              ? renderCodeLine(
                  fitDisplayText(
                    line.text,
                    Math.max(1, contentWidth - displayWidth(CODE_GUTTER)),
                  ),
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

  const visible = entries.slice(start, end);
  const visibleRows = visible.reduce(
    (sum, entry) => sum + Math.max(1, entry.estimatedRows),
    0,
  );
  let hiddenBefore = start;
  let hiddenAfter = entries.length - end;
  if (visibleRows + (hiddenBefore > 0 ? 1 : 0) + (hiddenAfter > 0 ? 1 : 0) > safeRows) {
    if (hiddenBefore > 0) hiddenBefore = 0;
    if (visibleRows + (hiddenAfter > 0 ? 1 : 0) > safeRows) hiddenAfter = 0;
  }

  return { visible, hiddenBefore, hiddenAfter };
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
