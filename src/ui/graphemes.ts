let segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== "function") return null;
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return segmenter;
}

export function splitGraphemes(input: string): string[] {
  const active = getSegmenter();
  if (!active) return Array.from(input);
  return Array.from(active.segment(input), (part) => part.segment);
}

export function graphemeLength(input: string): number {
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

function graphemeWidth(input: string): number {
  if (input.length === 0) return 0;
  if (/^\p{Mark}+$/u.test(input)) return 0;
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
  return splitGraphemes(input).reduce(
    (sum, grapheme) => sum + graphemeWidth(grapheme),
    0,
  );
}

export function fitDisplayText(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(input) <= maxWidth) return input;
  if (maxWidth === 1) return "…";

  let out = "";
  for (const part of splitGraphemes(input)) {
    if (displayWidth(`${out}${part}…`) > maxWidth) break;
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
  const next = [
    ...chars.slice(0, safeCursor),
    inserted,
    ...chars.slice(safeCursor),
  ].join("");
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

export function deleteAtCursor(
  input: string,
  cursor: number,
): { value: string; cursor: number } {
  const chars = splitGraphemes(input);
  const safeCursor = Math.max(0, Math.min(cursor, chars.length));
  if (safeCursor >= chars.length) return { value: input, cursor: safeCursor };
  chars.splice(safeCursor, 1);
  return {
    value: chars.join(""),
    cursor: safeCursor,
  };
}
