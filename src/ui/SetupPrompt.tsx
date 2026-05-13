import { Box, Text, render, useApp, useInput } from "ink";
import React, { useState } from "react";
import { isValidApiKey } from "../config.ts";
import { ThemeProvider, useTheme } from "./ThemeContext.tsx";
import { getActiveTheme } from "./themes.ts";

interface SetupPromptProps {
  onDone: (value: string | null) => void;
}

function SetupPrompt({ onDone }: SetupPromptProps) {
  const t = useTheme();
  const { exit } = useApp();
  const [key, setKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useInput((input, keypress) => {
    if (keypress.ctrl && input === "c") {
      onDone(null);
      exit();
      return;
    }
    if (keypress.return) {
      const trimmed = key.trim();
      if (!isValidApiKey(trimmed)) {
        setNotice("Enter a valid OpenRouter API key before continuing.");
        return;
      }
      onDone(trimmed);
      exit();
      return;
    }
    if (keypress.escape) {
      onDone(null);
      exit();
      return;
    }
    if (keypress.backspace || keypress.delete) {
      setKey((prev) => prev.slice(0, -1));
      setNotice(null);
      return;
    }
    if (!keypress.ctrl && !keypress.meta && input) {
      const filtered = input.replace(/[\x00-\x1f]/g, "");
      if (filtered.length > 0) {
        setKey((prev) => prev + filtered);
        setNotice(null);
      }
    }
  });

  const masked = key.length > 0 ? "•".repeat(Math.min(key.length, 48)) : "";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.primary} paddingX={1}>
      <Text color={t.primary} bold>
        Drexler first-run setup
      </Text>
      <Text color={t.dim}>OpenRouter key required. Get one at https://openrouter.ai/keys</Text>
      <Box marginTop={1}>
        <Text color={t.primary} bold>
          API key
        </Text>
        <Text color={t.dim}> │ </Text>
        <Text color={t.text}>{masked}</Text>
        <Text inverse>{key.length === 0 ? " " : ""}</Text>
      </Box>
      <Text color={t.dim}>Enter saves securely. Esc cancels. Ctrl+C exits.</Text>
      {notice ? <Text color={t.warning}>{notice}</Text> : null}
    </Box>
  );
}

export async function promptForApiKeyWithInk(): Promise<string | null> {
  let resolvePrompt!: (value: string | null) => void;
  const done = new Promise<string | null>((resolve) => {
    resolvePrompt = resolve;
  });
  const instance = render(
    React.createElement(ThemeProvider, {
      value: getActiveTheme(),
      children: React.createElement(SetupPrompt, {
        onDone: (value) => resolvePrompt(value),
      }),
    }),
    { exitOnCtrlC: false },
  );
  const value = await done;
  instance.unmount();
  return value;
}
