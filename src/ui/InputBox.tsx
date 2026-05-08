import { Box, Text } from "ink";
import { APOLLO, APOLLO_LIGHT, DIM_COLOR, TEXT_COLOR } from "./colors.ts";

interface Props {
  value: string;
  cursor: number;
  disabled: boolean;
  width: number;
  placeholder?: string;
}

export function InputBox({ value, cursor, disabled, width, placeholder }: Props) {
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

  const showPlaceholder = !disabled && value.length === 0 && placeholder;

  return (
    <Box borderStyle="round" borderColor={APOLLO} paddingX={1} width={width}>
      <Text color={APOLLO_LIGHT} bold>
        ❯{" "}
      </Text>
      {disabled ? (
        <Text color={DIM_COLOR}>(Drexler thinking… ESC to cancel)</Text>
      ) : showPlaceholder ? (
        <>
          <Text inverse color={TEXT_COLOR}>
            {" "}
          </Text>
          <Text color={DIM_COLOR}>{" " + placeholder}</Text>
        </>
      ) : (
        <>
          <Text color={TEXT_COLOR}>{before}</Text>
          <Text inverse color={TEXT_COLOR}>
            {at}
          </Text>
          <Text color={TEXT_COLOR}>{after}</Text>
        </>
      )}
    </Box>
  );
}

export function InputHint() {
  return (
    <Box paddingLeft={2}>
      <Text color={DIM_COLOR}>
        /help · /clear · /regenerate · /save · /exit
      </Text>
    </Box>
  );
}
