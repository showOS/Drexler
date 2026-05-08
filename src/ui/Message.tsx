import { Box, Text } from "ink";
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

export function Message({ role, content }: MessageItem) {
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
  const rendered = renderMarkdown(content).trimEnd();
  const lines = rendered.split("\n");
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

interface StreamingProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingProps) {
  const t = useTheme();
  const lines = content.split("\n");
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
