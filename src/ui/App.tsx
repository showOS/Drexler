import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dispatch,
  filterPaletteByPrefix,
  isSlash,
  type CommandAction,
} from "../commands.ts";
import { saveConfig } from "../config.ts";
import type { Conversation } from "../conversation.ts";
import { streamChat, type FetchFn } from "../llm.ts";
import { pickLayout } from "../renderer.ts";
import {
  buildMessagesWithReminder,
  detectPersonaDrift,
  pickFallback,
} from "../repl.ts";
import {
  EMPTY_NUDGE,
  SIGINT_MSG,
  STREAM_ERROR,
  THINKING_LINES,
  WITTICISMS,
} from "../sayings.ts";
import { type Config } from "../types.ts";
import { THEME_NAMES } from "../types.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { DealDeskHeader } from "./DealDeskHeader.tsx";
import {
  clampCursor,
  deleteAtCursor,
  deleteBeforeCursor,
  graphemeLength,
  insertAtCursor,
} from "./graphemes.ts";
import { InputBox } from "./InputBox.tsx";
import { StreamingMessage } from "./Message.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { ThemeProvider } from "./ThemeContext.tsx";
import { TranscriptViewport } from "./TranscriptViewport.tsx";
import { getActiveTheme, THEMES } from "./themes.ts";

const TRANSCRIPT_CHROME_ROWS = 12;

export function transcriptRowsForTerminalRows(rows: number): number {
  return Math.max(1, Math.min(24, rows - TRANSCRIPT_CHROME_ROWS));
}

export function nextTranscriptScrollOffset({
  current,
  itemCount,
  direction,
  step = 3,
}: {
  current: number;
  itemCount: number;
  direction: "older" | "newer";
  step?: number;
}): number {
  const maxOffset = Math.max(0, itemCount - 1);
  if (direction === "older") {
    return Math.min(maxOffset, current + step);
  }
  return Math.max(0, current - step);
}

export function shouldRemoveVisibleAssistantForAction(
  action: CommandAction,
): boolean {
  return action.type === "regenerate" && action.removedAssistant;
}

function pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error("pick called on empty array");
  }
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

interface ChatItem {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
}

interface AppProps {
  conversation: Conversation;
  config: Config;
  mood?: string;
  fetchFn?: FetchFn;
}

export function App({ conversation, config, mood = "neutral", fetchFn }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTheme, setActiveThemeSnapshot] = useState(() => getActiveTheme());
  const t = activeTheme;
  const [cols, setCols] = useState<number>(stdout?.columns ?? 80);
  const [rows, setRows] = useState<number>(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const handler = () => {
      setCols(stdout.columns ?? 80);
      setRows(stdout.rows ?? 24);
    };
    stdout.on("resize", handler);
    return () => {
      stdout.off("resize", handler);
    };
  }, [stdout]);
  const mode = useMemo(() => pickLayout(cols), [cols]);
  const inputWidth = useMemo(() => Math.max(1, cols), [cols]);
  const chromeWidth = useMemo(() => Math.max(1, cols), [cols]);
  const statusBarWidth = useMemo(() => Math.max(1, inputWidth - 2), [inputWidth]);
  const isCompact = mode === "very-narrow";
  const maxTranscriptRows = useMemo(
    () => transcriptRowsForTerminalRows(rows),
    [rows],
  );

  const [items, setItems] = useState<ChatItem[]>([]);
  const itemIdRef = useRef(0);
  const addItem = useCallback((role: ChatItem["role"], content: string) => {
    itemIdRef.current += 1;
    setItems((prev) => [...prev, { id: itemIdRef.current, role, content }]);
  }, []);
  const removeLastAssistantItem = useCallback(() => {
    setItems((prev) => {
      const idx = prev.findLastIndex((item) => item.role === "assistant");
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  const [draft, setDraft] = useState({ value: "", cursor: 0 });
  const draftRef = useRef(draft);
  const updateDraft = useCallback(
    (
      next:
        | { value: string; cursor: number }
        | ((prev: { value: string; cursor: number }) => {
            value: string;
            cursor: number;
          }),
    ) => {
      const resolved =
        typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = resolved;
      setDraft(resolved);
    },
    [],
  );
  const input = draft.value;
  const cursor = draft.cursor;
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [exitMsg, setExitMsg] = useState<string | null>(null);
  const [witticism, setWitticism] = useState<string>(pick(WITTICISMS));
  const [model, setModel] = useState<string>(config.model);
  const [msgCount, setMsgCount] = useState<number>(0);
  const [tokenCount, setTokenCount] = useState<number>(
    conversation.approximateTokens(),
  );
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [fallbackModel, setFallbackModel] = useState<string | null>(null);
  const [deskStatus, setDeskStatus] = useState<"idle" | "error">("idle");
  const [deskNotice, setDeskNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const paletteItems = useMemo(() => filterPaletteByPrefix(input), [input]);
  const paletteOpen = paletteItems.length > 0;
  useEffect(() => {
    setPaletteIdx(0);
  }, [input]);

  useEffect(() => {
    setScrollOffset(0);
  }, [items.length]);

  useEffect(() => {
    setTokenCount(conversation.approximateTokens());
  }, [conversation, msgCount]);

  const themeName = useMemo(() => {
    const active = getActiveTheme();
    return (
      THEME_NAMES.find((name) => THEMES[name] === active) ??
      config.theme ??
      "apollo"
    );
  }, [activeTheme, config.theme]);

  const scrollHint = useMemo(() => {
    if (items.length <= maxTranscriptRows) return undefined;
    return scrollOffset > 0 ? "PageDown newer" : "PageUp scrollback";
  }, [items.length, maxTranscriptRows, scrollOffset]);

  // throttle streaming updates so React doesn't re-render every token
  const streamBufRef = useRef("");
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const exitingRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushStream = useCallback(() => {
    if (!mountedRef.current) return;
    setStreaming(streamBufRef.current);
    streamTimerRef.current = null;
  }, []);

  const triggerExit = useCallback(
    (msg: string) => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      abortRef.current?.abort();
      setExitMsg(msg);
      exitTimerRef.current = setTimeout(() => exit(), 50);
    },
    [exit],
  );

  const pushTokenToStream = useCallback(
    (t: string) => {
      streamBufRef.current += t;
      if (streamTimerRef.current === null) {
        streamTimerRef.current = setTimeout(flushStream, 33);
      }
    },
    [flushStream],
  );

  const runLLM = useCallback(async (instruction?: string) => {
    const startedAt = Date.now();
    setThinking(pick(THINKING_LINES));
    setDeskStatus("idle");
    setDeskNotice(null);
    setFallbackModel(null);
    streamBufRef.current = "";
    setStreaming(null);
    let firstToken = true;
    abortRef.current = new AbortController();
    let result: Awaited<ReturnType<typeof streamChat>> | undefined;
    let caughtErr: unknown = null;
    try {
      result = await streamChat({
        apiKey: config.apiKey,
        model,
        fallbackModel: pickFallback(model),
        messages: instruction
          ? [
              ...buildMessagesWithReminder(conversation),
              { role: "system", content: instruction },
            ]
          : buildMessagesWithReminder(conversation),
        onToken: (t) => {
          if (!mountedRef.current) return;
          if (firstToken) {
            setThinking(null);
            firstToken = false;
          }
          pushTokenToStream(t);
        },
        signal: abortRef.current.signal,
        fetchFn,
      });
    } catch (err) {
      caughtErr = err;
    } finally {
      if (streamTimerRef.current !== null) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      abortRef.current = null;
    }
    if (!mountedRef.current) return;
    if (caughtErr) {
      const msg = caughtErr instanceof Error ? caughtErr.message : String(caughtErr);
      setThinking(null);
      setStreaming(null);
      addItem("system", `${STREAM_ERROR} [${msg}]`);
      setDeskStatus("error");
      setDeskNotice(msg);
      setMsgCount(conversation.length);
      return;
    }
    setThinking(null);
    setStreaming(null);
    setLastLatencyMs(Date.now() - startedAt);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      if (result?.content) {
        conversation.push("assistant", result.content);
        addItem("assistant", result.content);
      }
      addItem("system", "(cancelled — Drexler taking lunch)");
      setDeskNotice("response cancelled");
    } else if (result?.ok) {
      conversation.push("assistant", result.content);
      addItem("assistant", result.content);
      const notices: string[] = [];
      if (result.fellBack) {
        addItem("system", `(fell back to ${result.modelUsed})`);
        notices.push(`fallback ${result.modelUsed}`);
        setFallbackModel(result.modelUsed);
      }
      if (detectPersonaDrift(result.content)) {
        addItem("system", `(persona drift detected — model used 'I')`);
        notices.push("persona drift detected");
      }
      setDeskNotice(notices.length > 0 ? notices.join(" · ") : null);
    } else if (result?.interrupted) {
      conversation.push("assistant", result.content);
      addItem("assistant", result.content);
      addItem("system", "(stream interrupted — partial response saved)");
      setDeskStatus("error");
      setDeskNotice("stream interrupted; partial response saved");
    } else {
      const detail = result?.error ? ` [${result.error}]` : "";
      addItem("system", `${STREAM_ERROR}${detail}`);
      setDeskStatus("error");
      setDeskNotice(result?.error ?? "stream error");
    }
    setMsgCount(conversation.length);
    setTokenCount(conversation.approximateTokens());
    setWitticism(pick(WITTICISMS));
  }, [
    config,
    model,
    fetchFn,
    addItem,
    conversation,
    pushTokenToStream,
  ]);

  const handleSlashWithMutation = useCallback(
    async (line: string): Promise<void> => {
      let captured = "";
      const mutableConfig: Config = { ...config, model };
      const action = dispatch(line, {
        conversation,
        config: mutableConfig,
        print: (s) => {
          captured += (captured ? "\n" : "") + s;
        },
      });
      const lower = line.toLowerCase().trim();
      if (lower === "/clear" || lower.startsWith("/clear ")) {
        setItems([]);
        setLastLatencyMs(null);
        setFallbackModel(null);
      }
      if (mutableConfig.model !== model) {
        setModel(mutableConfig.model);
      }
      const appliedTheme =
        lower.startsWith("/theme ") && captured.includes("redecorate boardroom");
      if (appliedTheme || getActiveTheme() !== activeTheme) {
        setActiveThemeSnapshot(getActiveTheme());
        if (mutableConfig.theme) {
          setDeskStatus("idle");
          setDeskNotice(`theme ${mutableConfig.theme}`);
        }
      }
      if (action.type === "continue" && action.persistConfig) {
        try {
          await saveConfig(action.persistConfig);
          captured += `${captured ? "\n" : ""}Drexler preferences filed.`;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          captured += `${captured ? "\n" : ""}Could not save preferences: ${msg}`;
          setDeskStatus("error");
          setDeskNotice("preference save failed");
        }
      }
      if (captured) addItem("system", captured);
      if (action.type === "exit") {
        triggerExit(action.message ?? SIGINT_MSG);
        return;
      }
      if (action.type === "regenerate") {
        if (shouldRemoveVisibleAssistantForAction(action)) {
          removeLastAssistantItem();
        }
        await runLLM(action.instruction);
      }
      setMsgCount(conversation.length);
      setTokenCount(conversation.approximateTokens());
    },
    [
      addItem,
      conversation,
      config,
      activeTheme,
      model,
      removeLastAssistantItem,
      runLLM,
      triggerExit,
    ],
  );

  const onSubmit = useCallback(
    async (raw: string) => {
      const line = raw.trim();
      if (line === "") {
        addItem("system", EMPTY_NUDGE);
        return;
      }
      if (isSlash(line)) {
        await handleSlashWithMutation(line);
        return;
      }
      addItem("user", line);
      conversation.push("user", line);
      setMsgCount(conversation.length);
      setTokenCount(conversation.approximateTokens());
      await runLLM();
    },
    [addItem, conversation, handleSlashWithMutation, runLLM],
  );

  useInput((char, key) => {
    if (streaming !== null || thinking !== null) {
      if (key.escape) {
        cancelledRef.current = true;
        abortRef.current?.abort();
        return;
      }
      if (key.ctrl && char === "c") {
        triggerExit(SIGINT_MSG);
      }
      return;
    }
    if (paletteOpen && key.tab) {
      const sel = paletteItems[paletteIdx];
      if (sel) {
        updateDraft({
          value: sel.name + " ",
          cursor: graphemeLength(sel.name) + 1,
        });
      }
      return;
    }
    if (key.pageUp) {
      setScrollOffset((offset) =>
        nextTranscriptScrollOffset({
          current: offset,
          itemCount: items.length,
          direction: "older",
        }),
      );
      return;
    }
    if (key.pageDown) {
      setScrollOffset((offset) =>
        nextTranscriptScrollOffset({
          current: offset,
          itemCount: items.length,
          direction: "newer",
        }),
      );
      return;
    }
    if (paletteOpen && key.return) {
      const sel = paletteItems[paletteIdx];
      if (sel) {
        updateDraft({ value: "", cursor: 0 });
        setHistoryIdx(null);
        void onSubmit(sel.name);
      }
      return;
    }
    if (key.return) {
      const submitted = draftRef.current.value;
      updateDraft({ value: "", cursor: 0 });
      setHistoryIdx(null);
      const trimmedSubmit = submitted.trim();
      if (trimmedSubmit.length > 0) {
        setHistory((prev) => {
          const next = [...prev, trimmedSubmit];
          return next.length > 50 ? next.slice(-50) : next;
        });
      }
      void onSubmit(submitted);
      return;
    }
    if (key.ctrl && char === "c") {
      triggerExit(SIGINT_MSG);
      return;
    }
    if (paletteOpen && key.escape) {
      updateDraft({ value: "", cursor: 0 });
      return;
    }
    if (key.tab) {
      return;
    }
    if (key.backspace) {
      updateDraft((prev) => deleteBeforeCursor(prev.value, prev.cursor));
      return;
    }
    if (key.delete) {
      updateDraft((prev) => deleteAtCursor(prev.value, prev.cursor));
      return;
    }
    if (key.leftArrow) {
      updateDraft((prev) => ({
        value: prev.value,
        cursor: Math.max(0, prev.cursor - 1),
      }));
      return;
    }
    if (key.rightArrow) {
      updateDraft((prev) => ({
        value: prev.value,
        cursor: Math.min(graphemeLength(prev.value), prev.cursor + 1),
      }));
      return;
    }
    if (key.upArrow) {
      if (paletteOpen) {
        setPaletteIdx(
          (i) => (i - 1 + paletteItems.length) % paletteItems.length,
        );
        return;
      }
      if (history.length === 0) return;
      const idx = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      const entry = history[idx] ?? "";
      setHistoryIdx(idx);
      updateDraft({ value: entry, cursor: graphemeLength(entry) });
      return;
    }
    if (key.downArrow) {
      if (paletteOpen) {
        setPaletteIdx((i) => (i + 1) % paletteItems.length);
        return;
      }
      if (historyIdx === null) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        updateDraft({ value: "", cursor: 0 });
      } else {
        const entry = history[next] ?? "";
        setHistoryIdx(next);
        updateDraft({ value: entry, cursor: graphemeLength(entry) });
      }
      return;
    }
    if (key.ctrl && char === "a") {
      updateDraft((prev) => ({ value: prev.value, cursor: 0 }));
      return;
    }
    if (key.ctrl && char === "e") {
      updateDraft((prev) => ({
        value: prev.value,
        cursor: graphemeLength(prev.value),
      }));
      return;
    }
    if (key.ctrl && char === "u") {
      updateDraft({ value: "", cursor: 0 });
      return;
    }
    // Plain text input. Filter out control chars except printable.
    if (!key.ctrl && !key.meta && char) {
      // accept multi-char (paste)
      const filtered = char.replace(/[\x00-\x1f]/g, "");
      if (filtered.length > 0) {
        updateDraft((prev) =>
          insertAtCursor(
            prev.value,
            clampCursor(prev.value, prev.cursor),
            filtered,
          ),
        );
      }
    }
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (streamTimerRef.current !== null) {
        clearTimeout(streamTimerRef.current);
      }
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  const isBusy = streaming !== null || thinking !== null;
  const headerStatus = isBusy ? "streaming" : deskStatus;

  return (
    <ThemeProvider value={activeTheme}>
      <Box flexDirection="column">
        <DealDeskHeader
          model={model}
          mood={mood}
          messageCount={msgCount}
          themeName={themeName}
          approximateTokens={tokenCount}
          latencyMs={lastLatencyMs}
          fallbackModel={fallbackModel}
          status={headerStatus}
          compact={isCompact}
          notice={deskNotice ?? undefined}
          maxWidth={chromeWidth}
        />
        <TranscriptViewport
          items={items}
          maxRows={maxTranscriptRows}
          cols={chromeWidth}
          compact={isCompact}
          scrollOffset={scrollOffset}
        />

        <Box flexDirection="column">
          {streaming !== null && (
            <Box marginBottom={1}>
              <StreamingMessage content={streaming} width={chromeWidth} />
            </Box>
          )}
          {thinking !== null && streaming === null && (
            <Box paddingX={1} marginBottom={1}>
              <Spinner label={thinking} width={chromeWidth} />
            </Box>
          )}
          {exitMsg !== null ? (
            <Box paddingX={1} marginBottom={1}>
              <Text color={t.primaryLight} bold>
                {exitMsg}
              </Text>
            </Box>
          ) : (
            <>
              {paletteOpen && (
                <CommandPalette
                  items={paletteItems}
                  selectedIdx={paletteIdx}
                  width={chromeWidth}
                />
              )}
              <Box flexDirection="column">
                <InputBox
                  value={input}
                  cursor={cursor}
                  disabled={isBusy}
                  width={inputWidth}
                />
              </Box>
              <Box paddingLeft={2}>
                <StatusBar
                  messageCount={msgCount}
                  witticism={witticism}
                  maxWidth={statusBarWidth}
                  status={isBusy ? "streaming" : deskStatus}
                  compact={isCompact}
                  scrollHint={scrollHint}
                />
              </Box>
            </>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
