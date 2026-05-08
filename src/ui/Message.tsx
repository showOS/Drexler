import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { renderMarkdown } from "../renderer.ts";
import { useTheme } from "./ThemeContext.tsx";

interface MessageItem {
  role: "user" | "assistant" | "system";
  content: string;
}

function Separator() {
  const t = useTheme();
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={t.primaryDim}>{"─".repeat(40)}</Text>
    </Box>
  );
}

function MessageInner({ role, content }: MessageItem) {
  const t = useTheme();
  if (role === "user") {
    return (
      <>
        <Box paddingX={1} marginBottom={1}>
          <Text color={t.dim}>❯ </Text>
          <Text color={t.text}>{content}</Text>
        </Box>
      </>
    );
  }
  if (role === "system") {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text color={t.dim} italic>
          {content}
        </Text>
      </Box>
    );
  }
  // assistant: left accent bar + markdown rendering, separator below
  const lines = useMemo(
    () => renderMarkdown(content).trimEnd().split("\n"),
    [content],
  );
  return (
    <>
      <Box flexDirection="column" marginBottom={1}>
        {lines.map((ln, i) => (
          <Box key={i}>
            <Text color={t.primary}>│ </Text>
            <Text>{ln}</Text>
          </Box>
        ))}
      </Box>
      <Separator />
    </>
  );
}

export const Message = memo(MessageInner);

interface StreamingProps {
  content: string;
}

function StreamingMessageInner({ content }: StreamingProps) {
  const t = useTheme();
  const lines = useMemo(() => content.split("\n"), [content]);
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Box key={i}>
          <Text color={t.primary}>│ </Text>
          <Text color={t.text}>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}

export const StreamingMessage = memo(StreamingMessageInner);
