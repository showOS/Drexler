import chalk from "chalk";
import { highlight } from "cli-highlight";
import { Box, Text } from "ink";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import React from "react";
import {
  APOLLO,
  APOLLO_DIM,
  APOLLO_LIGHT,
  DIM_COLOR,
  TEXT_COLOR,
} from "./colors.ts";

function highlightCode(code: string, lang: string | undefined): string {
  try {
    if (lang) return highlight(code, { language: lang, ignoreIllegals: true });
    return highlight(code, { ignoreIllegals: true });
  } catch {
    return chalk.gray(code);
  }
}

let mdConfigured = false;
function ensureMarkedConfigured(): void {
  if (mdConfigured) return;
  marked.use(
    markedTerminal({
      code: ((code: string, lang?: string) => highlightCode(code, lang)) as never,
      blockquote: chalk.hex(DIM_COLOR).italic,
      heading: chalk.hex(APOLLO_LIGHT).bold,
      hr: chalk.hex(APOLLO_DIM),
      listitem: chalk.hex(TEXT_COLOR),
      strong: chalk.bold,
      em: chalk.italic,
      codespan: chalk.gray.bgBlackBright,
      link: chalk.hex(APOLLO_LIGHT).underline,
    }) as never,
  );
  mdConfigured = true;
}

function renderMd(content: string): string {
  ensureMarkedConfigured();
  return String(marked.parse(content, { async: false })).trimEnd();
}

interface MessageItem {
  role: "user" | "assistant" | "system";
  content: string;
}

export function Message({ role, content }: MessageItem) {
  if (role === "user") {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text color={DIM_COLOR}>❯ </Text>
        <Text color={TEXT_COLOR}>{content}</Text>
      </Box>
    );
  }
  if (role === "system") {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text color={DIM_COLOR} italic>
          {content}
        </Text>
      </Box>
    );
  }
  // assistant: left accent bar + markdown rendering
  const rendered = renderMd(content);
  const lines = rendered.split("\n");
  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.map((ln, i) => (
        <Box key={i}>
          <Text color={APOLLO}>│ </Text>
          <Text>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}

interface StreamingProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingProps) {
  const lines = content.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Box key={i}>
          <Text color={APOLLO}>│ </Text>
          <Text color={TEXT_COLOR}>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}
