import { Box, Text } from "ink";
import { memo, useMemo } from "react";
import type { SlashCommand } from "../commands.ts";
import { displayWidth, fitDisplayText } from "./graphemes.ts";
import { useTheme } from "./ThemeContext.tsx";

interface Props {
  items: ReadonlyArray<SlashCommand>;
  selectedIdx: number;
  width?: number;
}

export const COMMAND_HINTS: Record<string, string> = {
  "/help": "open directive list",
  "/clear": "reset transcript",
  "/exit": "close session",
  "/synergy": "morale event",
  "/model": "/model 26b",
  "/theme": "/theme midnight",
  "/startup": "/startup fast",
  "/history": "show ledger stats",
  "/regenerate": "retry last answer",
  "/redo": "same as /regenerate",
  "/retry": "/retry terse",
  "/expand": "print latest response",
  "/quote": "quote latest response",
  "/search": "/search covenant",
  "/export": "/export html board-memo.html",
  "/save": "/save deal-notes.md",
  "/save-last": "/save-last last-response.md",
  "/copy-last": "copy latest response",
  "/copy": "/copy 4",
  "/edit": "/edit 3",
  "/setup": "show config + key source",
  "/update": "bun update -g drexler --latest",
  "/auth": "/auth sk-or-... (replace in-session)",
  "/pet": "open pet deal desk",
  "/feed": "feed Drexler a deal memo",
  "/play": "corporate synergy game",
  "/work": "grind the deal pipeline",
  "/praise": "affirm Drexler's contributions",
  "/rest": "strategic nap",
  "/vibe": "let Drexler pick the move",
  "/name": "/name Bartholomew",
  "/profile": "print personnel file",
};

const ARGUMENT_TITLES: Record<string, { title: string; hint: string }> = {
  "/theme": { title: "THEMES", hint: "tab fill, ↑↓ choose, enter apply" },
  "/startup": { title: "STARTUP", hint: "tab fill, ↑↓ choose, enter save" },
  "/retry": { title: "RETRY", hint: "tab fill, ↑↓ choose, enter reroll" },
  "/export": { title: "EXPORT", hint: "tab fill, ↑↓ choose, enter run" },
  "/model": { title: "MODELS", hint: "tab fill, ↑↓ choose, enter switch" },
};

function paletteHeading(items: ReadonlyArray<SlashCommand>): {
  title: string;
  hint: string;
} {
  const firstToken = items[0]?.name.split(" ")[0] ?? "";
  const hasArguments = items.some((item) => item.name.includes(" "));
  if (hasArguments && ARGUMENT_TITLES[firstToken]) {
    return ARGUMENT_TITLES[firstToken];
  }
  return {
    title: "DIRECTIVES",
    hint: "tab/↑↓ select, enter execute",
  };
}

function padDisplayText(input: string, width: number): string {
  const clipped = fitDisplayText(input, width);
  return `${clipped}${" ".repeat(Math.max(0, width - displayWidth(clipped)))}`;
}

function CommandPaletteInner({ items, selectedIdx, width = 80 }: Props) {
  const t = useTheme();
  const safeWidth = Math.max(1, Math.floor(width));
  const tiny = safeWidth < 26;
  const heading = useMemo(() => paletteHeading(items), [items]);
  const maxNameW = useMemo(
    () => items.reduce((m, i) => Math.max(m, displayWidth(i.name)), 0),
    [items],
  );
  if (items.length === 0) return null;

  if (tiny) {
    return (
      <Box flexDirection="column" width={safeWidth} flexShrink={1}>
        {items.map((item, idx) => {
          const sel = idx === selectedIdx;
          const line = `${sel ? "› " : "  "}${item.name}`;
          return (
            <Text
              key={item.name}
              color={sel ? t.primaryLight : t.primaryDim}
              bold={sel}
              wrap="truncate"
            >
              {fitDisplayText(line, safeWidth)}
            </Text>
          );
        })}
      </Box>
    );
  }

  const innerWidth = Math.max(1, safeWidth - 4);
  const markerWidth = 2;
  const nameBudget = Math.max(
    6,
    Math.min(maxNameW + 1, Math.floor(innerWidth * 0.44)),
  );
  const descBudget = Math.max(
    6,
    Math.min(
      Math.floor(innerWidth * 0.34),
      innerWidth - markerWidth - nameBudget - 1,
    ),
  );
  const hintBudget = Math.max(
    0,
    innerWidth - markerWidth - nameBudget - 1 - descBudget - 2,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.primaryDim}
      paddingX={1}
      marginBottom={1}
      width={safeWidth}
      flexShrink={1}
    >
      <Box marginBottom={1}>
        <Text color={t.primaryLight} bold>
          {heading.title}
        </Text>
        <Text color={t.primaryDim}> ─ </Text>
        <Text color={t.dim} wrap="truncate">
          {fitDisplayText(
            heading.hint,
            Math.max(1, innerWidth - displayWidth(heading.title) - 3),
          )}
        </Text>
      </Box>
      {items.map((item, idx) => {
        const sel = idx === selectedIdx;
        const isArgumentSuggestion = item.name.includes(" ");
        const hint =
          item.hint ??
          (isArgumentSuggestion ? "" : COMMAND_HINTS[item.name] ?? item.description);
        const name = padDisplayText(item.name, nameBudget);
        const desc = padDisplayText(item.description, descBudget);
        const clippedHint =
          hintBudget > 0 ? fitDisplayText(hint, hintBudget) : "";
        return (
          <Box key={item.name} width={innerWidth} flexShrink={1}>
            <Text color={sel ? t.primaryLight : t.primaryDim} bold={sel}>
              {sel ? "› " : "  "}
            </Text>
            <Text color={sel ? t.primaryLight : t.primary} bold={sel}>
              {name}
            </Text>
            <Text color={t.primaryDim}> </Text>
            <Text color={sel ? t.text : t.dim}>
              {desc}
            </Text>
            {clippedHint ? (
              <>
                <Text color={t.primaryDim}>  </Text>
                <Text color={sel ? t.primaryLight : t.primaryDim} wrap="truncate">
                  {clippedHint}
                </Text>
              </>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export const CommandPalette = memo(CommandPaletteInner);
