import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { renderMarkdown } from "../renderer.ts";
import { fitDisplayText } from "./graphemes.ts";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { useTheme } from "./ThemeContext.tsx";

interface MessageItem {
  role: "user" | "assistant" | "system";
  content: string;
}

const SEPARATOR_WIDTH = 44;

const ROLE_LABELS: Record<MessageItem["role"], string> = {
  user: "YOU",
  assistant: "DREXLER",
  system: "SYSTEM",
};

function Separator() {
  const t = useTheme();
  return (
    <Box paddingX={1} marginBottom={1} flexShrink={1}>
      <Text color={t.primaryDim} wrap="truncate">
        {"─".repeat(SEPARATOR_WIDTH)}
      </Text>
    </Box>
  );
}

function MessageInner({ role, content }: MessageItem) {
  const t = useTheme();
  const assistantLines = useMemo(
    () =>
      role === "assistant"
        ? renderMarkdown(content).trimEnd().split("\n")
        : [],
    [content, role],
  );

  if (role === "user") {
    return (
      <>
        <Box paddingX={1} marginBottom={1} flexDirection="column">
          <Box>
            <Text color={t.primaryLight} bold>
              {ROLE_LABELS.user}
            </Text>
            <Text color={t.primaryDim}> ─ </Text>
            <Text color={t.dim}>incoming memo</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text color={t.primary}>› </Text>
            <Text color={t.text} wrap="wrap">
              {content}
            </Text>
          </Box>
        </Box>
      </>
    );
  }
  if (role === "system") {
    return (
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Box>
          <Text color={t.warning} bold>
            {ROLE_LABELS.system}
          </Text>
          <Text color={t.primaryDim}> ─ </Text>
          <Text color={t.dim}>notice</Text>
        </Box>
        <Box paddingLeft={1}>
          <Text color={t.dim} italic wrap="wrap">
            {content}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box>
          <Text color={t.primaryLight} bold>
            {ROLE_LABELS.assistant}
          </Text>
          <Text color={t.primaryDim}> ─ </Text>
          <Text color={t.dim}>response ledger</Text>
        </Box>
        {assistantLines.map((ln, i) => (
          <Box key={i} paddingLeft={1}>
            <Text color={i === 0 ? t.primary : t.primaryDim}>│ </Text>
            <Text color={t.text} wrap="wrap">
              {ln}
            </Text>
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
  width?: number;
}

function StreamingMessageInner({ content, width = 80 }: StreamingProps) {
  const t = useTheme();
  const safeWidth = Math.max(1, Math.floor(width));
  const innerWidth = Math.max(1, safeWidth - 2);

  if (safeWidth < 18) {
    const compactLine = fitDisplayText(content.replace(/\s+/g, " "), safeWidth);
    return (
      <Box width={safeWidth} flexShrink={1}>
        <Text color={t.primaryLight} wrap="truncate">
          {compactLine}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} width={safeWidth} flexShrink={1}>
      <Box>
        <Text color={t.primaryLight} bold>
          {ROLE_LABELS.assistant}
        </Text>
        <Text color={t.primaryDim}> ─ </Text>
        <Text color={t.dim}>drafting live</Text>
      </Box>
      <MarkdownBody
        content={content}
        baseColor={t.text}
        accentColor={t.primaryLight}
        dimColor={t.dim}
        codeColor={t.primaryDim}
        width={innerWidth}
        paddingLeft={1}
      />
    </Box>
  );
}

export const StreamingMessage = memo(StreamingMessageInner);
