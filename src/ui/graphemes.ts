let segmenter: Intl.Segmenter | null = null;

// Pure ASCII printable (\x20-\x7e) + TAB/LF/CR. Every code point in this
// set is exactly one grapheme cluster — no combining marks, no
// surrogates, no zero-width joiners — so we can skip Intl.Segmenter
// entirely. English-heavy chat is the dominant case; Segmenter +
// Array.from over its iterator is the single largest per-render cost
// in transcript, markdown, status, and input rendering.
const ASCII_ONLY_RE = /^[\x20-\x7e\t\n\r]*$/;

function isAsciiOnly(s: string): boolean {
  return ASCII_ONLY_RE.test(s);
}

function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== "function") return null;
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return segmenter;
}

export function splitGraphemes(input: string): string[] {
  if (isAsciiOnly(input)) return Array.from(input);
  const active = getSegmenter();
  if (!active) return Array.from(input);
  return Array.from(active.segment(input), (part) => part.segment);
}

export function graphemeLength(input: string): number {
  // ASCII (\x20-\x7e + TAB/LF/CR) is BMP single-code-unit, no combining
  // marks → JS string length equals grapheme count. Skip the Array.from
  // allocation in splitGraphemes for the hot path.
  if (isAsciiOnly(input)) return input.length;
  return splitGraphemes(input).length;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  );
}

export function graphemeWidth(input: string): number {
  if (input.length === 0) return 0;
  if (/^\p{Mark}+$/u.test(input)) return 0;
  if (/^[©®™]$/u.test(input)) return 1;
  if (/\p{Extended_Pictographic}/u.test(input)) return 2;
  let width = 0;
  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
      continue;
    }
    if (/\p{Mark}/u.test(char)) continue;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function displayWidth(input: string): number {
  if (isAsciiOnly(input)) {
    // Tab/LF/CR are < 32 → graphemeWidth returns 0 for them; printable
    // \x20-\x7e all have width 1. Count printable bytes only, preserving
    // existing semantics for control chars in multi-line drafts.
    let w = 0;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      if (c >= 0x20 && c <= 0x7e) w++;
    }
    return w;
  }
  return splitGraphemes(input).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}

const ELLIPSIS_WIDTH = 1;

export function fitDisplayText(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(input) <= maxWidth) return input;
  if (maxWidth === 1) return "…";

  // Single-pass accumulator: track running width instead of recomputing
  // displayWidth(out + part + "…") on every grapheme (O(n²) → O(n)).
  // This is the dominant cost for every fitDisplayText call across the
  // transcript / markdown / status bar render paths.
  const budget = maxWidth - ELLIPSIS_WIDTH;
  let used = 0;
  let out = "";
  for (const part of splitGraphemes(input)) {
    const partWidth = graphemeWidth(part);
    if (used + partWidth > budget) break;
    used += partWidth;
    out += part;
  }
  return `${out}…`;
}

export function clampCursor(input: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, graphemeLength(input)));
}

export function insertAtCursor(
  input: string,
  cursor: number,
  inserted: string,
): { value: string; cursor: number } {
  const chars = splitGraphemes(input);
  const safeCursor = Math.max(0, Math.min(cursor, chars.length));
  const next = [...chars.slice(0, safeCursor), inserted, ...chars.slice(safeCursor)].join("");
  return {
    value: next,
    cursor: safeCursor + graphemeLength(inserted),
  };
}

export function deleteBeforeCursor(
  input: string,
  cursor: number,
): { value: string; cursor: number } {
  const chars = splitGraphemes(input);
  const safeCursor = Math.max(0, Math.min(cursor, chars.length));
  if (safeCursor === 0) return { value: input, cursor: 0 };
  chars.splice(safeCursor - 1, 1);
  return {
    value: chars.join(""),
    cursor: safeCursor - 1,
  };
}

export function deleteAtCursor(input: string, cursor: number): { value: string; cursor: number } {
  const chars = splitGraphemes(input);
  const safeCursor = Math.max(0, Math.min(cursor, chars.length));
  if (safeCursor >= chars.length) return { value: input, cursor: safeCursor };
  chars.splice(safeCursor, 1);
  return {
    value: chars.join(""),
    cursor: safeCursor,
  };
}
