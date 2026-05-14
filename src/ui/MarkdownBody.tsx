import { Box, Text } from "ink";
import { Fragment, memo, useMemo, type ReactNode } from "react";
import { displayWidth } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

type Block =
  | { kind: "para"; lines: string[] }
  | { kind: "heading"; level: number; line: string }
  | { kind: "bullet"; marker: string; indent: number; line: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; lang?: string; lines: string[] }
  | { kind: "hr" }
  | { kind: "blank" };

const BULLET_RE = /^(\s*)([*+-]|\d+\.)\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])\1\1[-*_\s]*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

function isFenceClose(line: string, marker: string): boolean {
  const fenceChar = marker[0];
  if (!fenceChar) return false;
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  for (const char of trimmed) {
    if (char !== fenceChar) return false;
  }
  return true;
}

const inlineTokenCache = new Map<string, InlineToken[]>();
const MAX_INLINE_TOKEN_CACHE = 1024;

export function tokenizeInline(input: string): InlineToken[] {
  const cached = inlineTokenCache.get(input);
  if (cached !== undefined) {
    // Bump to MRU
    inlineTokenCache.delete(input);
    inlineTokenCache.set(input, cached);
    return cached;
  }

  const tokens: InlineToken[] = [];
  let buf = "";
  let i = 0;
  const flushBuf = () => {
    if (buf.length > 0) {
      tokens.push({ text: buf });
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        flushBuf();
        tokens.push({ text: input.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }

    if ((ch === "*" && next === "*") || (ch === "_" && next === "_")) {
      const marker = `${ch}${ch}`;
      const end = input.indexOf(marker, i + 2);
      if (end !== -1 && end > i + 2) {
        flushBuf();
        const inner = input.slice(i + 2, end);
        for (const sub of tokenizeInline(inner)) {
          tokens.push({ ...sub, bold: true });
        }
        i = end + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const prev = input[i - 1];
      if (next !== undefined && next !== ch && next !== " " && next !== "\t") {
        let end = -1;
        for (let j = i + 1; j < input.length; j++) {
          if (
            input[j] === ch &&
            input[j - 1] !== " " &&
            input[j + 1] !== ch &&
            input[j - 1] !== ch
          ) {
            end = j;
            break;
          }
        }
        if (end !== -1 && (prev === undefined || /\s|[([{]/.test(prev))) {
          flushBuf();
          tokens.push({ text: input.slice(i + 1, end), italic: true });
          i = end + 1;
          continue;
        }
      }
    }

    if (ch === "[") {
      const closeBracket = input.indexOf("]", i + 1);
      if (closeBracket !== -1 && input[closeBracket + 1] === "(") {
        let depth = 1;
        let closeParen = -1;
        for (let k = closeBracket + 2; k < input.length; k++) {
          const c = input[k];
          if (c === "(") depth += 1;
          else if (c === ")") {
            depth -= 1;
            if (depth === 0) {
              closeParen = k;
              break;
            }
          }
        }
        if (closeParen !== -1) {
          flushBuf();
          const text = input.slice(i + 1, closeBracket);
          const url = input.slice(closeBracket + 2, closeParen);
          tokens.push({ text, link: url });
          i = closeParen + 1;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }
  flushBuf();

  if (inlineTokenCache.size >= MAX_INLINE_TOKEN_CACHE) {
    const oldest = inlineTokenCache.keys().next().value;
    if (oldest !== undefined) inlineTokenCache.delete(oldest);
  }
  inlineTokenCache.set(input, tokens);
  return tokens;
}

export function parseBlocks(input: string): Block[] {
  const lines = input.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2]?.trim() || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !isFenceClose(lines[i]!, marker)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang, lines: codeLines });
      continue;
    }

    if (line.trim().length === 0) {
      blocks.push({ kind: "blank" });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        line: heading[2]!,
      });
      i += 1;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const quoteLines: string[] = [quote[1] ?? ""];
      i += 1;
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]!);
        if (!m) break;
        quoteLines.push(m[1] ?? "");
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      blocks.push({
        kind: "bullet",
        marker: bullet[2]!,
        indent: bullet[1]!.length,
        line: bullet[3]!,
      });
      i += 1;
      continue;
    }

    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const peek = lines[i]!;
      if (
        peek.trim().length === 0 ||
        FENCE_RE.test(peek) ||
        HR_RE.test(peek) ||
        HEADING_RE.test(peek) ||
        QUOTE_RE.test(peek) ||
        BULLET_RE.test(peek)
      ) {
        break;
      }
      paraLines.push(peek);
      i += 1;
    }
    blocks.push({ kind: "para", lines: paraLines });
  }

  return blocks;
}

function renderInline(tokens: InlineToken[], colors: { code: string; link: string }): ReactNode[] {
  return tokens.map((tok, idx) => {
    if (tok.code) {
      return (
        <Text key={idx} color={colors.code}>
          {/* intentional U+2009 thin spaces for inline code visual padding */}
          {/* eslint-disable-next-line no-irregular-whitespace */}
          {` ${tok.text} `}
        </Text>
      );
    }
    if (tok.link) {
      return (
        <Text key={idx} color={colors.link} underline>
          {tok.text}
        </Text>
      );
    }
    return (
      <Text key={idx} bold={tok.bold} italic={tok.italic}>
        {tok.text}
      </Text>
    );
  });
}

interface MarkdownBodyProps {
  content: string;
  baseColor?: string;
  accentColor?: string;
  dimColor?: string;
  codeColor?: string;
  width?: number;
  paddingLeft?: number;
}

function bulletGlyph(marker: string, indent: number): string {
  if (/^\d+\.$/.test(marker)) return `${marker} `;
  if (indent >= 4) return "◦ ";
  return "• ";
}

function MarkdownBodyInner({
  content,
  baseColor,
  accentColor,
  dimColor,
  codeColor,
  width,
  paddingLeft = 0,
}: MarkdownBodyProps) {
  const t = useTheme();
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const text = baseColor ?? t.text;
  const accent = accentColor ?? t.primaryLight;
  const dim = dimColor ?? t.dim;
  const code = codeColor ?? t.primaryDim;
  const inlineColors = { code, link: accent };
  const safeWidth = width !== undefined ? Math.max(1, Math.floor(width)) : undefined;
  const ruleWidth = safeWidth !== undefined ? Math.max(4, safeWidth - paddingLeft - 1) : 24;

  return (
    <Box flexDirection="column" flexShrink={1}>
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "blank":
            return <Box key={idx} height={1} />;
          case "hr":
            return (
              <Box key={idx} paddingLeft={paddingLeft}>
                <Text color={dim}>{"─".repeat(ruleWidth)}</Text>
              </Box>
            );
          case "heading": {
            const headColor = block.level <= 2 ? accent : text;
            return (
              <Box key={idx} paddingLeft={paddingLeft}>
                <Text color={headColor} bold wrap="wrap">
                  {block.line}
                </Text>
              </Box>
            );
          }
          case "bullet": {
            const glyph = bulletGlyph(block.marker, block.indent);
            const indent = paddingLeft + Math.min(4, Math.floor(block.indent / 2));
            return (
              <Box key={idx} paddingLeft={indent}>
                <Text color={accent}>{glyph}</Text>
                <Text color={text} wrap="wrap">
                  {renderInline(tokenizeInline(block.line), inlineColors)}
                </Text>
              </Box>
            );
          }
          case "quote":
            return (
              <Box key={idx} paddingLeft={paddingLeft} flexDirection="column">
                {block.lines.map((ln, j) => (
                  <Box key={j}>
                    <Text color={accent}>{"┃ "}</Text>
                    <Text color={dim} italic wrap="wrap">
                      {renderInline(tokenizeInline(ln), inlineColors)}
                    </Text>
                  </Box>
                ))}
              </Box>
            );
          case "code":
            return (
              <Box key={idx} paddingLeft={paddingLeft} flexDirection="column">
                {block.lang ? <Text color={dim}>[{block.lang.toLowerCase()}]</Text> : null}
                {block.lines.map((ln, j) => (
                  <Box key={j}>
                    <Text color={code}>{"│ "}</Text>
                    <Text color={text}>{ln}</Text>
                  </Box>
                ))}
              </Box>
            );
          case "para":
            return (
              <Box key={idx} paddingLeft={paddingLeft} flexDirection="column">
                {block.lines.map((ln, j) => (
                  <Text key={j} color={text} wrap="wrap">
                    {renderInline(tokenizeInline(ln), inlineColors)}
                  </Text>
                ))}
              </Box>
            );
          default:
            return <Fragment key={idx} />;
        }
      })}
    </Box>
  );
}

export const MarkdownBody = memo(MarkdownBodyInner);

// Approximate row count for selectWindow budgeting. Each block contributes
// at least one row; paragraphs/quotes use line count plus naive width wrap.
export function estimateMarkdownRows(content: string, width: number): number {
  const blocks = parseBlocks(content);
  const safe = Math.max(1, Math.floor(width));
  let rows = 0;
  for (const block of blocks) {
    if (block.kind === "blank") {
      rows += 1;
      continue;
    }
    if (block.kind === "hr") {
      rows += 1;
      continue;
    }
    if (block.kind === "heading" || block.kind === "bullet") {
      rows += Math.max(1, Math.ceil(displayWidth(block.line) / safe));
      continue;
    }
    if (block.kind === "quote" || block.kind === "para") {
      for (const ln of block.lines) {
        rows += Math.max(1, Math.ceil(displayWidth(ln) / safe));
      }
      continue;
    }
    if (block.kind === "code") {
      rows += block.lines.length + (block.lang ? 1 : 0);
      continue;
    }
  }
  return Math.max(1, rows);
}
