import { Box, Text } from "ink";
import { useTheme } from "./ThemeContext.tsx";

interface Props {
  value: string;
  cursor: number;
  disabled: boolean;
  width: number;
}

export function InputBox({ value, cursor, disabled, width }: Props) {
  const t = useTheme();
  // Grapheme-aware splitting so emoji / multi-byte chars don't render as
  // broken surrogate pairs when the cursor lands mid-codepoint.
  const chars = Array.from(value);
  const safeCursor = Math.max(0, Math.min(cursor, chars.length));
  const before = chars.slice(0, safeCursor).join("");
  const at = chars[safeCursor] ?? " ";
  const after = chars.slice(safeCursor + 1).join("");

  return (
    <Box borderStyle="round" borderColor={t.primary} paddingX={1} width={width}>
      <Text color={t.primaryLight} bold>
        ❯{" "}
      </Text>
      {disabled ? (
        <Text color={t.dim}>(Drexler thinking… ESC to cancel)</Text>
      ) : (
        <>
          <Text color={t.text}>{before}</Text>
          <Text inverse color={t.text}>
            {at}
          </Text>
          <Text color={t.text}>{after}</Text>
        </>
      )}
    </Box>
  );
}
