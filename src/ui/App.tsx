import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatch, filterPaletteByPrefix, isSlash } from "../commands.ts";
import type { Conversation } from "../conversation.ts";
import { streamChat, type FetchFn } from "../llm.ts";
import { pickLayout } from "../renderer.ts";
import { detectPersonaDrift } from "../repl.ts";
import {
  DRIFT_REMINDER,
  EMPTY_NUDGE,
  REMINDER_INTERVAL,
  SIGINT_MSG,
  STREAM_ERROR,
  THINKING_LINES,
  WITTICISMS,
} from "../sayings.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "../types.ts";
import { useTheme } from "./ThemeContext.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { InputBox } from "./InputBox.tsx";
import { Message, StreamingMessage } from "./Message.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusBar } from "./StatusBar.tsx";

const MAX_INPUT_WIDTH = 80;

function pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error("pick called on empty array");
  }
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function pickFallback(model: string): string {
  return model === MODEL_PRIMARY ? MODEL_FALLBACK : MODEL_PRIMARY;
}

interface ChatItem {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
}

interface AppProps {
  conversation: Conversation;
  config: Config;
  fetchFn?: FetchFn;
}

export function App({ conversation, config, fetchFn }: AppProps) {
  const t = useTheme();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState<number>(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const handler = () => setCols(stdout.columns ?? 80);
    stdout.on("resize", handler);
    return () => {
      stdout.off("resize", handler);
    };
  }, [stdout]);
  const mode = pickLayout(cols);
  const inputWidth = Math.max(1, Math.min(cols, MAX_INPUT_WIDTH));

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

  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [exitMsg, setExitMsg] = useState<string | null>(null);
  const [witticism, setWitticism] = useState<string>(pick(WITTICISMS));
  const [model, setModel] = useState<string>(config.model);
  const [msgCount, setMsgCount] = useState<number>(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);

  const paletteItems = useMemo(() => filterPaletteByPrefix(input), [input]);
  const paletteOpen = paletteItems.length > 0;
  useEffect(() => {
    setPaletteIdx(0);
  }, [input]);

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

  const buildMessagesWithReminder = useCallback(() => {
    const snap = conversation.snapshot();
    const turns = conversation.userTurns;
    if (turns > 0 && turns % REMINDER_INTERVAL === 0) {
      return [...snap, { role: "system" as const, content: DRIFT_REMINDER }];
    }
    return snap;
  }, [conversation]);

  const runLLM = useCallback(async () => {
    setThinking(pick(THINKING_LINES));
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
        messages: buildMessagesWithReminder(),
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
      setMsgCount(conversation.length);
      return;
    }
    setThinking(null);
    setStreaming(null);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      if (result?.content) {
        conversation.push("assistant", result.content);
        addItem("assistant", result.content);
      }
      addItem("system", "(cancelled — Drexler taking lunch)");
    } else if (result?.ok) {
      conversation.push("assistant", result.content);
      addItem("assistant", result.content);
      if (result.fellBack) {
        addItem("system", `(fell back to ${result.modelUsed})`);
      }
      if (detectPersonaDrift(result.content)) {
        addItem("system", `(persona drift detected — model used 'I')`);
      }
    } else if (result?.interrupted) {
      conversation.push("assistant", result.content);
      addItem("assistant", result.content);
      addItem("system", "(stream interrupted — partial response saved)");
    } else {
      const detail = result?.error ? ` [${result.error}]` : "";
      addItem("system", `${STREAM_ERROR}${detail}`);
    }
    setMsgCount(conversation.length);
    setWitticism(pick(WITTICISMS));
  }, [
    config,
    model,
    fetchFn,
    addItem,
    buildMessagesWithReminder,
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
      }
      if (mutableConfig.model !== model) {
        setModel(mutableConfig.model);
      }
      if (captured) addItem("system", captured);
      if (action.type === "exit") {
        triggerExit(action.message ?? SIGINT_MSG);
        return;
      }
      if (action.type === "regenerate") {
        removeLastAssistantItem();
        await runLLM();
      }
      setMsgCount(conversation.length);
    },
    [
      addItem,
      conversation,
      config,
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
        setInput(sel.name + " ");
        setCursor(sel.name.length + 1);
      }
      return;
    }
    if (paletteOpen && key.return) {
      const sel = paletteItems[paletteIdx];
      if (sel) {
        setInput("");
        setCursor(0);
        setHistoryIdx(null);
        void onSubmit(sel.name);
      }
      return;
    }
    if (key.return) {
      const submitted = input;
      setInput("");
      setCursor(0);
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
      setInput("");
      setCursor(0);
      return;
    }
    if (key.tab) {
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setInput((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(input.length, c + 1));
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
      setInput(entry);
      setCursor(entry.length);
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
        setInput("");
        setCursor(0);
      } else {
        const entry = history[next] ?? "";
        setHistoryIdx(next);
        setInput(entry);
        setCursor(entry.length);
      }
      return;
    }
    if (key.ctrl && char === "a") {
      setCursor(0);
      return;
    }
    if (key.ctrl && char === "e") {
      setCursor(input.length);
      return;
    }
    if (key.ctrl && char === "u") {
      setInput("");
      setCursor(0);
      return;
    }
    // Plain text input. Filter out control chars except printable.
    if (!key.ctrl && !key.meta && char) {
      // accept multi-char (paste)
      const filtered = char.replace(/[\x00-\x1f]/g, "");
      if (filtered.length > 0) {
        setInput((prev) => prev.slice(0, cursor) + filtered + prev.slice(cursor));
        setCursor((c) => c + filtered.length);
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

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {items.map((item) => (
          <Box key={item.id} flexDirection="column">
            <Message role={item.role} content={item.content} />
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        {streaming !== null && (
          <Box marginBottom={1}>
            <StreamingMessage content={streaming} />
          </Box>
        )}
        {thinking !== null && streaming === null && (
          <Box paddingX={1} marginBottom={1}>
            <Spinner label={thinking} />
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
              <CommandPalette items={paletteItems} selectedIdx={paletteIdx} />
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
                maxWidth={Math.max(1, inputWidth - 2)}
                status={isBusy ? "streaming" : "idle"}
                compact={mode === "very-narrow"}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
