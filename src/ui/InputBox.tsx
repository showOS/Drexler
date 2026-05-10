import { Box, Text } from "ink";
import { memo } from "react";
import { clampCursor, displayWidth, splitGraphemes } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

interface Props {
  value: string;
  cursor: number;
  disabled: boolean;
  width: number;
  disabledLabel?: string;
}

const PROMPT_WIDTH = 2;
const BOX_CHROME_WIDTH = 4;
const FRAMED_MIN_WIDTH = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

function fitWindow(
  chars: string[],
  cursor: number,
  maxWidth: number,
): { start: number; end: number; leftOverflow: boolean; rightOverflow: boolean } {
  let markerReserve = 0;
  let result = { start: cursor, end: cursor, leftOverflow: false, rightOverflow: false };

  for (let pass = 0; pass < 3; pass++) {
    const available = Math.max(1, maxWidth - markerReserve);
    let start = cursor;
    let end = cursor < chars.length ? cursor + 1 : cursor;
    let used = cursor < chars.length ? displayWidth(chars[cursor] ?? "") : 1;

    while (start > 0) {
      const nextWidth = displayWidth(chars[start - 1] ?? "");
      if (used + nextWidth > available) break;
      start -= 1;
      used += nextWidth;
    }

    while (end < chars.length) {
      const nextWidth = displayWidth(chars[end] ?? "");
      if (used + nextWidth > available) break;
      end += 1;
      used += nextWidth;
    }

    const leftOverflow = start > 0;
    const rightOverflow = end < chars.length;
    const nextReserve = (leftOverflow ? 1 : 0) + (rightOverflow ? 1 : 0);
    result = { start, end, leftOverflow, rightOverflow };
    if (nextReserve === markerReserve) break;
    markerReserve = nextReserve;
  }

  return result;
}

function fitPlainText(chars: string[], cursor: number, maxWidth: number): string {
  const available = Math.max(1, maxWidth);
  const window = fitWindow(chars, cursor, available);
  const visible = chars.slice(window.start, window.end);
  const visibleCursor = clamp(cursor - window.start, 0, visible.length);
  const parts = [
    window.leftOverflow ? "…" : "",
    ...visible.slice(0, visibleCursor),
    visible[visibleCursor] && displayWidth(visible[visibleCursor]!) <= available
      ? visible[visibleCursor]!
      : " ",
    ...visible.slice(visibleCursor + 1),
    window.rightOverflow ? "…" : "",
  ];
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    if (displayWidth(out + part) > available) break;
    out += part;
  }
  return out || " ";
}

function InputBoxInner({
  value,
  cursor,
  disabled,
  width,
  disabledLabel,
}: Props) {
  const t = useTheme();
  const chars = splitGraphemes(value);
  const safeCursor = clampCursor(value, cursor);
  const boxWidth = Math.max(1, width);
  const inputBudget = Math.max(1, boxWidth - BOX_CHROME_WIDTH - PROMPT_WIDTH);
  const disabledText = disabledLabel ?? "(Drexler thinking... ESC to cancel)";
  const window = fitWindow(chars, safeCursor, inputBudget);
  const visible = chars.slice(window.start, window.end);
  const visibleCursor = clamp(safeCursor - window.start, 0, visible.length);
  const before = visible.slice(0, visibleCursor).join("");
  const at = visible[visibleCursor] ?? " ";
  const after = visible.slice(visibleCursor + 1).join("");

  if (boxWidth < FRAMED_MIN_WIDTH) {
    const plainBudget = Math.max(1, boxWidth - PROMPT_WIDTH);
    const plain = disabled
      ? disabledText.slice(0, plainBudget)
      : fitPlainText(chars, safeCursor, plainBudget);
    return (
      <Box width={boxWidth} flexShrink={1}>
        <Text color={t.primaryLight} bold wrap="truncate">
          ❯{" "}
        </Text>
        <Text color={disabled ? t.dim : t.text} wrap="truncate">
          {plain}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={disabled ? t.primaryDim : t.primary}
      paddingX={1}
      width={boxWidth}
      flexShrink={1}
    >
      <Text color={t.primaryLight} bold>
        ❯{" "}
      </Text>
      {disabled ? (
        <Text color={t.dim} wrap="truncate">
          {disabledText}
        </Text>
      ) : (
        <>
          {window.leftOverflow ? <Text color={t.primaryDim}>…</Text> : null}
          <Text color={t.text}>{before}</Text>
          <Text inverse color={t.text}>
            {at}
          </Text>
          <Text color={t.text}>{after}</Text>
          {window.rightOverflow ? <Text color={t.primaryDim}>…</Text> : null}
        </>
      )}
    </Box>
  );
}

export const InputBox = memo(InputBoxInner);
