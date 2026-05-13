import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import { firstDisplayLine, normalizeAssistantBoth } from "./displayContent.ts";
import { fitDisplayText } from "./graphemes.ts";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { useTheme } from "./ThemeContext.tsx";

const ROLE_LABELS = { assistant: "DREXLER" } as const;

interface StreamingProps {
  content: string;
  width?: number;
}

function StreamingMessageInner({ content, width = 80 }: StreamingProps) {
  const t = useTheme();
  const safeWidth = Math.max(1, Math.floor(width));
  const innerWidth = Math.max(1, safeWidth - 2);
  // Single fence-scan produces both forms. Memo so a re-render that
  // doesn't touch `content` (e.g. theme flip, parent re-layout) doesn't
  // redo the parse.
  const { compact: compactDisplayContent, markdownRender: markdownDisplayContent } = useMemo(
    () => normalizeAssistantBoth(content),
    [content],
  );

  if (safeWidth < 18) {
    const compactLine = fitDisplayText(
      firstDisplayLine(compactDisplayContent).replace(/\s+/g, " "),
      safeWidth,
    );
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
      <Box paddingLeft={1}>
        <Text color={t.primaryLight} bold>
          {ROLE_LABELS.assistant}
        </Text>
        <Text color={t.primaryDim}> ─ </Text>
        <Text color={t.dim}>drafting live</Text>
      </Box>
      <MarkdownBody
        content={markdownDisplayContent}
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
