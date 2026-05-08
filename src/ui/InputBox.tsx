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
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

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

export function InputHint() {
  const t = useTheme();
  return (
    <Box paddingLeft={2}>
      <Text color={t.dim}>
        /help · /clear · /regenerate · /save · /exit
      </Text>
    </Box>
  );
}
