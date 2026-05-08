import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatch, isSlash } from "../commands.ts";
import type { Conversation } from "../conversation.ts";
import { streamChat, type FetchFn } from "../llm.ts";
import { detectPersonaDrift } from "../repl.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "../types.ts";
import { APOLLO_LIGHT } from "./colors.ts";
import { InputBox, InputHint } from "./InputBox.tsx";
import { Message, StreamingMessage } from "./Message.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusBar } from "./StatusBar.tsx";

const SLASH_COMMANDS = [
  "/help",
  "/clear",
  "/exit",
  "/synergy",
  "/model",
  "/history",
  "/regenerate",
  "/save",
];

const WITTICISMS = [
  "Drexler never fly coach",
  "Drexler greed is good",
  "Buy low. Sell… uh… low",
  "Drexler eat paperwork for breakfast",
  "Stonks go up",
  "Numbers Steve currently in Cayman Islands",
  "HR Director Karen filed complaint. Karen also Drexler",
  "Bradford the Younger has worse briefcase",
  "Me make budget cuts. Drexler keep bonus",
  "Drexler thrive in Chapter 11",
  "Drexler file 13D before breakfast",
  "Drexler buy junk bonds for breakfast",
  "Spin off underperforming Bradford",
  "Drexler's harvest season",
  "Vulture Vance circling 14th floor",
  "Pemberton drafting. Pemberton always drafting",
  "Bankruptcy is opportunity. Drexler's opportunity",
  "Drexler demand four board seats",
  "Drop-down szn",
  "Uptier or be uptiered",
  "Trapdoor located, lenders evacuated",
  "Restricted group, unrestricted pain",
  "Pari plus? Pari LOL",
  "Serta'd",
  "J. Crewed",
  "Recovery rate: 6 cents. Drexler's: 143 cents",
  "Drexler stake: 4.99%. Counts carefully",
  "Examiner is Drexler. Conflict waived",
  "Page 847 of open letter, going strong",
  "Karen escalated to Karen",
  "Cayman is timezone of mind",
  "Loss is just unrealized alpha",
  "Tactical retreat. Bonus intact",
  "Patient money. Vultures wait. Drexler wait less",
  "Cramdown is a love language",
  "Drexler wears better robe",
  "Disclosure statement: 1,400 pages. Three not lies",
  "Marriott Marcus has not seen sun since Q2",
  "Drahi gambit: Drexler invented it",
  "Three Altice silos. Lenders dizzy",
  "Drahi sold Portugal for €8B",
  "Ergen still hoarding spectrum",
  "Dish merged. Then unmerged. Then re-merged",
  "Ergen winning at 4 AM poker",
  "Xerox PARC into JV. Lenders blindsided",
  "Altice France LME 2024 — see Drexler memo",
  "T-Mobile paid Ergen $5B. Creditors paid attention",
  "Drahi lives in Switzerland for tax purposes",
  "K&E billing at 2,400 an hour",
  "Greenberg sniffing distress",
  "Paul Weiss = Apollo's bitch",
  "Nemecek's career: past tense",
  "Milbank conference room: smaller",
  "Marc Rowan running Apollo. Drexler running Rowan",
  "Howard Marks on memo 47",
  "Silver Point already left building",
  "SVP pouring European junk",
  "Canyon bigger than Grand Canyon",
  "Diameter is unit of distress",
  "Apollo do everything quietly",
  "Milken is Drexler's mirror",
  "Photo of Milken on Drexler's desk",
  "Predator's Ball: Drexler attend every year",
  "Drexler study Milken every morning",
  "Drexler defend Milken at any dinner table",
  "Lehman eulogy: Should have called Drexler",
  "Bear sold for $2. Drexler bid one penny",
  "Fuld ran Lehman into ground. Drexler advised bigger ground",
  "Cayne played bridge. Drexler played poker. Both lost firms",
  "Self-pardon: Drexler 1991, Trump 2020",
  "AIG bailout: $182B. Drexler bailout: $182T",
];

const PLACEHOLDERS = [
  'try: "explain J. Crew" · "what is uptier" · /help',
  'try: "tell me about Milken" · "what is creation multiple"',
  'try: "explain Altice France" · /regenerate · /history',
  'try: "what is a 363 sale" · "/save" · "/synergy"',
  'try: "who is Charlie Ergen" · "explain LME"',
];

const THINKING_LINES = [
  "Drexler consulting quarterly reports",
  "Reviewing TPS reports",
  "Checking Drexler's calendar",
  "Drexler's legal team reviewing",
  "Running due diligence",
  "Numbers Steve crunching numbers",
  "Briefcase opening",
  "Drexler convene emergency meeting",
  "Drexler think… Drexler grow rich",
];

const EMPTY_NUDGE = "Drexler's time is money. YOUR money. Speak up.";
const STREAM_ERROR = "Trading tantrum! Drexler's stream interrupted. Try again.";
const SIGINT_MSG = "Drexler do exit interview. Meeting adjourned.";
const REMINDER_INTERVAL = 5;
const DRIFT_REMINDER =
  "Reminder: stay in character. ≤4 sentences. Never use 'I'. ≤1 catchphrase. Land the joke last.";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] ?? (arr[0] as T);
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
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const inputWidth = Math.min(cols - 4, 100);

  const [items, setItems] = useState<ChatItem[]>([]);
  const itemIdRef = useRef(0);
  const addItem = useCallback((role: ChatItem["role"], content: string) => {
    itemIdRef.current += 1;
    setItems((prev) => [...prev, { id: itemIdRef.current, role, content }]);
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
  const [placeholder] = useState<string>(pick(PLACEHOLDERS));

  // throttle streaming updates so React doesn't re-render every token
  const streamBufRef = useRef("");
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const flushStream = useCallback(() => {
    setStreaming(streamBufRef.current);
    streamTimerRef.current = null;
  }, []);

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
    let result;
    try {
      result = await streamChat({
        apiKey: config.apiKey,
        model,
        fallbackModel: pickFallback(model),
        messages: buildMessagesWithReminder(),
        onToken: (t) => {
          if (firstToken) {
            setThinking(null);
            firstToken = false;
          }
          pushTokenToStream(t);
        },
        signal: abortRef.current.signal,
        fetchFn,
      });
    } finally {
      if (streamTimerRef.current !== null) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      abortRef.current = null;
    }
    setThinking(null);
    setStreaming(null);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      addItem("system", "(cancelled — Drexler taking lunch)");
    } else if (result.ok && result.content !== null) {
      conversation.push("assistant", result.content);
      addItem("assistant", result.content);
      if (result.fellBack) {
        addItem("system", `(fell back to ${result.modelUsed})`);
      }
      if (detectPersonaDrift(result.content)) {
        addItem("system", `(persona drift detected — model used 'I')`);
      }
    } else {
      const detail = result.error ? ` [${result.error}]` : "";
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
        setExitMsg(action.message ?? SIGINT_MSG);
        setTimeout(() => exit(), 50);
        return;
      }
      if (action.type === "regenerate") {
        await runLLM();
      }
      setMsgCount(conversation.length);
    },
    [addItem, conversation, config, model, runLLM, exit],
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
        abortRef.current?.abort();
        setExitMsg(SIGINT_MSG);
        setTimeout(() => exit(), 50);
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
      setExitMsg(SIGINT_MSG);
      setTimeout(() => exit(), 50);
      return;
    }
    if (key.tab) {
      const trimmed = input.trim();
      if (trimmed.startsWith("/")) {
        const hit = SLASH_COMMANDS.find((c) => c.startsWith(trimmed));
        if (hit) {
          setInput(hit + " ");
          setCursor(hit.length + 1);
        }
      }
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
      if (history.length === 0) return;
      const idx = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      const entry = history[idx] ?? "";
      setHistoryIdx(idx);
      setInput(entry);
      setCursor(entry.length);
      return;
    }
    if (key.downArrow) {
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
      if (streamTimerRef.current !== null) {
        clearTimeout(streamTimerRef.current);
      }
    };
  }, []);

  const isBusy = streaming !== null || thinking !== null;

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) => (
          <Box key={item.id} flexDirection="column">
            <Message role={item.role} content={item.content} />
          </Box>
        )}
      </Static>

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
            <Text color={APOLLO_LIGHT} bold>
              {exitMsg}
            </Text>
          </Box>
        ) : (
          <>
            <Box flexDirection="row" alignItems="center">
              <InputBox
                value={input}
                cursor={cursor}
                disabled={isBusy}
                width={inputWidth}
                placeholder={placeholder}
              />
              <Box marginLeft={2}>
                <StatusBar
                  messageCount={msgCount}
                  witticism={witticism}
                />
              </Box>
            </Box>
            <InputHint />
          </>
        )}
      </Box>
    </Box>
  );
}
