import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  accrueLifetimeDeals,
  actionCooldown,
  applyFeed,
  applyDecay,
  applyName,
  applyPlay,
  applyPraise,
  applyRest,
  applyVibe,
  applyWork,
  flushPetSaves,
  formatCooldownRemaining,
  formatTenure,
  getPetMood,
  getPetRank,
  isPetDead,
  loadPetState,
  petTenureMs,
  rankLabel,
  sanitizePetName,
  savePetState,
  stampAction,
  type PetActionKey,
  type PetActivity,
  type PetStats,
} from "../pet/petState.ts";
import { DeathScreen } from "./DeathScreen.tsx";
import {
  CompactPetPanel,
  COMPACT_PET_PANEL_MIN_WIDTH,
  COMPACT_PET_PANEL_ROWS,
  TINY_PET_PANEL_ROWS,
  type Environment,
} from "./PetPanel.tsx";
import {
  dispatch,
  filterPaletteByPrefix,
  isArgumentParentCommand,
  isSlash,
  type CommandAction,
} from "../commands.ts";
import { isValidApiKey, saveConfig } from "../config.ts";
import type { Conversation } from "../conversation.ts";
import { buildSavedSession, saveSession } from "../conversation/persist.ts";
import { getRecentTelemetry, streamChat, type FetchFn } from "../llm.ts";
import { pickLayout } from "../renderer.ts";
import { buildMessagesWithReminder, detectPersonaDrift, pickFallback } from "../repl.ts";
import { EMPTY_NUDGE, SIGINT_MSG, STREAM_ERROR, THINKING_LINES, WITTICISMS } from "../sayings.ts";
import { type Config } from "../types.ts";
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
import { introPhaseColor, MascotDashboard, useIntroAnimation } from "./MascotIntro.tsx";
import { StreamingMessage } from "./Message.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusBar } from "./StatusBar.tsx";
import {
  pickSynergyEvent,
  SynergyEvent,
  SYNERGY_EVENT_FRAMES,
  synergyEventRows,
  type SynergyEventDefinition,
} from "./SynergyEvent.tsx";
import { ThemeProvider } from "./ThemeContext.tsx";
import { estimateTranscriptRows, TranscriptViewport } from "./TranscriptViewport.tsx";
import { getActiveTheme } from "./themes.ts";

const TRANSCRIPT_CHROME_ROWS = 12;

export function transcriptRowsForTerminalRows(rows: number): number {
  return Math.max(1, Math.min(24, rows - TRANSCRIPT_CHROME_ROWS));
}

export function nextTranscriptScrollOffset({
  current,
  itemCount,
  totalRows,
  visibleRows,
  direction,
  step = 3,
}: {
  current: number;
  itemCount?: number;
  totalRows?: number;
  visibleRows?: number;
  direction: "older" | "newer";
  step?: number;
}): number {
  const maxOffset =
    totalRows !== undefined
      ? Math.max(0, totalRows - Math.max(1, visibleRows ?? 1))
      : Math.max(0, (itemCount ?? 0) - 1);
  if (direction === "older") {
    return Math.min(maxOffset, current + step);
  }
  return Math.max(0, current - step);
}

export function shouldRemoveVisibleAssistantForAction(action: CommandAction): boolean {
  return action.type === "regenerate" && action.removedAssistant;
}

// Replace a timer handle on a ref. Cancels any prior timer first so two
// fire-paths (e.g. pet-death + Ctrl-C) cannot leave a dangling callback
// after the latest assignment.
export function replaceExitTimer(
  ref: { current: ReturnType<typeof setTimeout> | null },
  fn: () => void,
  delayMs: number,
): void {
  if (ref.current !== null) clearTimeout(ref.current);
  ref.current = setTimeout(() => {
    ref.current = null;
    fn();
  }, delayMs);
}

export interface Debouncer {
  schedule: (fn: () => void) => void;
  cancel: () => void;
  hasPending: () => boolean;
}

// Coalesce rapid calls into one delayed fire. Each schedule replaces the
// pending callback; cancel suppresses any pending fire. Used to keep
// session-persistence writes off the hot path during burst turns.
export function makeDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    hasPending() {
      return timer !== null;
    },
  };
}

export interface HistoryNavState {
  historyIdx: number | null;
  draft: { value: string; cursor: number };
  historyDraft: { value: string; cursor: number } | null;
}

export function historyNavStep(
  state: HistoryNavState,
  history: readonly string[],
  direction: "up" | "down",
): HistoryNavState {
  if (direction === "up") {
    if (history.length === 0) return state;
    const snapshot = state.historyIdx === null ? { ...state.draft } : state.historyDraft;
    const idx = state.historyIdx === null ? history.length - 1 : Math.max(0, state.historyIdx - 1);
    const entry = history[idx] ?? "";
    return {
      historyIdx: idx,
      draft: { value: entry, cursor: graphemeLength(entry) },
      historyDraft: snapshot,
    };
  }
  if (state.historyIdx === null) return state;
  const next = state.historyIdx + 1;
  if (next >= history.length) {
    const restored = state.historyDraft ?? { value: "", cursor: 0 };
    return { historyIdx: null, draft: restored, historyDraft: null };
  }
  const entry = history[next] ?? "";
  return {
    historyIdx: next,
    draft: { value: entry, cursor: graphemeLength(entry) },
    historyDraft: state.historyDraft,
  };
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

interface ActiveSynergyEvent {
  event: SynergyEventDefinition;
  frame: number;
}

interface AppProps {
  conversation: Conversation;
  config: Config;
  mood?: string;
  fetchFn?: FetchFn;
  greeting?: string;
  showIntroChrome?: boolean;
  introInitiallyDone?: boolean;
}

export function App({
  conversation,
  config,
  mood = "neutral",
  fetchFn,
  greeting,
  showIntroChrome = false,
  introInitiallyDone = false,
}: AppProps) {
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
  const chromeWidth = useMemo(() => Math.max(1, cols), [cols]);
  const isCompact = mode === "very-narrow";
  const [introDone, setIntroDone] = useState(introInitiallyDone);
  const dashboardAllowed = showIntroChrome && typeof greeting === "string";
  const showFullDashboard = dashboardAllowed && rows >= 32;
  const introActive = showFullDashboard && !introDone;
  const [petMode, setPetMode] = useState(false);
  const petModeRef = useRef(false);
  const showFallbackPetPanel = petMode && !showFullDashboard;
  const fallbackPetRowBudget = showFallbackPetPanel
    ? cols >= COMPACT_PET_PANEL_MIN_WIDTH
      ? COMPACT_PET_PANEL_ROWS
      : TINY_PET_PANEL_ROWS
    : 0;
  const contentWidth = chromeWidth;
  const contentInputWidth = Math.max(1, contentWidth);
  const dashboardRowBudget = showFullDashboard
    ? chromeWidth >= 112
      ? 14
      : chromeWidth >= 72
        ? 26
        : 6
    : 0;
  const maxTranscriptRows = useMemo(
    () =>
      Math.max(1, transcriptRowsForTerminalRows(rows) - dashboardRowBudget - fallbackPetRowBudget),
    [dashboardRowBudget, fallbackPetRowBudget, rows],
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
  const removeLastUserItem = useCallback(() => {
    setItems((prev) => {
      const idx = prev.findLastIndex((item) => item.role === "user");
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  // Persist the current conversation to disk so the next launch can
  // offer a resume. Best-effort: a failed save never blocks chat.
  // Debounced 800ms so a burst of turns (e.g. rapid /retry → /regenerate)
  // collapses to one async write instead of N sync writes that would
  // block the Ink event loop.
  const persistDebouncer = useMemo(() => makeDebouncer(800), []);
  const [model, setModel] = useState<string>(config.model);
  const conversationRef = useRef(conversation);
  const modelRef = useRef(model);
  conversationRef.current = conversation;
  modelRef.current = model;
  const writePersistNow = useCallback(() => {
    const currentConversation = conversationRef.current;
    void saveSession(
      buildSavedSession(currentConversation, currentConversation.systemPrompt, modelRef.current),
    ).catch(() => {
      // saveSession already swallows; defensive catch in case the
      // promise rejects before the internal try/catch runs.
    });
  }, []);
  const flushPersistSession = useCallback(() => {
    persistDebouncer.cancel();
    writePersistNow();
  }, [persistDebouncer, writePersistNow]);
  const persistSession = useCallback(() => {
    persistDebouncer.schedule(writePersistNow);
  }, [persistDebouncer, writePersistNow]);

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
      const resolved = typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = resolved;
      setDraft(resolved);
    },
    [],
  );
  const input = draft.value;
  const cursor = draft.cursor;
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [synergyEvent, setSynergyEvent] = useState<ActiveSynergyEvent | null>(null);
  const [exitMsg, setExitMsg] = useState<string | null>(null);
  const [witticism, setWitticism] = useState<string>(() => pick(WITTICISMS));
  const [apiKey, setApiKey] = useState<string>(config.apiKey);
  const [msgCount, setMsgCount] = useState<number>(0);
  const [deskStatus, setDeskStatus] = useState<"idle" | "error">("idle");
  const [deskNotice, setDeskNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const handleIntroComplete = useCallback(() => {
    setIntroDone(true);
  }, []);
  const intro = useIntroAnimation(chromeWidth, introActive, handleIntroComplete);

  const [petStats, setPetStats] = useState<PetStats>(() => loadPetState());
  const [petActivity, setPetActivity] = useState<PetActivity>("idle");
  const [isDead, setIsDead] = useState(false);
  const [deathReason, setDeathReason] = useState("energy");
  const [deathVariant, setDeathVariant] = useState(0);
  const petStatsRef = useRef<PetStats>(petStats);
  const petActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const petDecayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const petEnv: Environment = "office";

  const PET_MESSAGES = useMemo(
    () => ({
      feed: [
        "Drexler receives deal memo. Hunger: satisfied. Pipeline: expanding.",
        "Drexler consumes quarterly report. Fortifying.",
        "Deal deck delivered. Drexler is replenished.",
        "Nutrition acquired via term sheet. Excellent.",
        "Drexler ingests synergy bundle. Caloric intake: maximized.",
        "Pipeline refueled. Drexler gives brief nod of approval.",
      ],
      play: [
        "Drexler engages in corporate synergy games. Morale: elevated.",
        "Drexler attempts leisure. Unfamiliar but effective.",
        "Golf simulation initiated. Handicap: nonexistent.",
        "Corporate retreat protocols engaged. Team building: successful.",
        "Drexler plays. Competitors watch nervously.",
        "Recreational time allocated. ROI: unclear but positive.",
      ],
      work: [
        "Drexler retreats to deal desk. Pipeline throughput: increasing.",
        "Grind mode initiated. Coffee consumed preemptively.",
        "Drexler is doing the work. Others take note.",
        "Deal origination in progress. Board is watching.",
        "Drexler enters flow state. Productivity: exceptional.",
        "All-nighter commenced. Regrets: minimal.",
      ],
      praise: [
        "Drexler acknowledges commendation. Briefly.",
        "Praise received. Filed under: expected.",
        "Drexler nods. One singular nod.",
        "Affirmation noted. Drexler remains unmoved. Mostly.",
        "Kind words processed. Ego: appropriately inflated.",
        "Drexler accepts compliment with characteristic restraint.",
      ],
      rest: [
        "Drexler retires briefly. Strategic recharge in progress.",
        "Under-desk nap initiated. Do not disturb.",
        "Drexler powers down. Temporarily.",
        "Rest mode engaged. Energy recovery: imminent.",
        "Strategic downtime commenced. Drexler will return stronger.",
        "Drexler sleeps. Dreams of closed deals.",
      ],
    }),
    [],
  );

  const triggerPetActivity = useCallback((activity: PetActivity, durationMs: number) => {
    if (petActivityTimerRef.current !== null) {
      clearTimeout(petActivityTimerRef.current);
    }
    setPetActivity(activity);
    petActivityTimerRef.current = setTimeout(() => {
      setPetActivity("idle");
      petActivityTimerRef.current = null;
    }, durationMs);
  }, []);
  const setDashboardPetMode = useCallback((next: boolean) => {
    petModeRef.current = next;
    setPetMode(next);
  }, []);
  // Reducer must stay pure: no IO, no ref writes. Ref mirror lives in
  // the effect below; persistence lives in its own save effect. React 19
  // StrictMode runs reducers twice in dev — any side effect here would
  // double-fire (e.g. duplicate disk writes).
  const updatePetStats = useCallback((updater: (stats: PetStats, now: number) => PetStats) => {
    const now = Date.now();
    setPetStats((stats) => {
      const next = updater(stats, now);
      return next === stats ? stats : { ...next, lastSaved: now };
    });
  }, []);
  const applyPetAction = useCallback(
    (action: PetActionKey, mutator: (stats: PetStats) => PetStats) => {
      // Run the mutator inside React's setState reducer so we always
      // operate on the latest committed stats. Returning a value from
      // the reducer is the only race-free way to compose with a
      // concurrent decay tick — `() => precomputed` would silently
      // overwrite anything the decay setInterval just committed.
      updatePetStats((stats, now) =>
        accrueLifetimeDeals(stampAction(mutator(stats), action, now), action),
      );
    },
    [updatePetStats],
  );

  // Surface rank promotions as a system memo. Driven off committed
  // state via lifetimeDeals so a decay tick that races with a pet
  // action can't drop the memo on the floor.
  const prevRankRef = useRef(getPetRank(petStats));
  useEffect(() => {
    const current = getPetRank(petStats);
    if (current !== prevRankRef.current) {
      const previous = prevRankRef.current;
      prevRankRef.current = current;
      // Only celebrate forward motion; a decay-induced rank drop
      // shouldn't trigger a fake promotion.
      const order = ["intern", "analyst", "associate", "vp", "md"] as const;
      if (order.indexOf(current) > order.indexOf(previous)) {
        addItem(
          "system",
          `PROMOTION MEMO: Drexler ranked up to ${rankLabel(current)}. Reward: more meetings.`,
        );
      }
    }
  }, [petStats, addItem]);

  useEffect(() => {
    petStatsRef.current = petStats;
  }, [petStats]);

  // Persist committed pet state. Skips the initial mount so we don't
  // re-write the same bytes we just loaded. applyDecay returns same
  // identity when no real decay occurred, so the decay setInterval
  // does not re-trigger this effect on every tick.
  const petSaveInitRef = useRef(false);
  useEffect(() => {
    if (!petSaveInitRef.current) {
      petSaveInitRef.current = true;
      return;
    }
    savePetState(petStats);
  }, [petStats]);

  // Real-time stat decay matches the offline per-hour decay rate.
  useEffect(() => {
    petDecayTimerRef.current = setInterval(() => {
      updatePetStats(applyDecay);
    }, 60_000);
    return () => {
      if (petDecayTimerRef.current !== null) {
        clearInterval(petDecayTimerRef.current);
        petDecayTimerRef.current = null;
      }
      if (petActivityTimerRef.current !== null) {
        clearTimeout(petActivityTimerRef.current);
        petActivityTimerRef.current = null;
      }
      savePetState(petStatsRef.current);
    };
  }, [updatePetStats]);

  // Death detection
  useEffect(() => {
    if (isDead || !isPetDead(petStats)) return;
    const reason =
      petStats.hunger <= 0 ? "hunger" : petStats.happiness <= 0 ? "happiness" : "energy";
    setDeathReason(reason);
    setDeathVariant(Math.floor(Math.random() * 5));
    setIsDead(true);
    const deadStats = { ...petStats, dead: true };
    petStatsRef.current = deadStats;
    savePetState(deadStats);
    // Death exit: give the 5s death-screen its full hold time, then
    // drain any pending pet writes before Ink tears down so the `dead:
    // true` payload definitely lands on disk.
    replaceExitTimer(
      exitTimerRef,
      () => {
        flushPetSaves().then(
          () => exit(),
          () => exit(),
        );
      },
      5000,
    );
  }, [petStats, isDead, exit]);

  const paletteItems = useMemo(() => filterPaletteByPrefix(input), [input]);
  const paletteOpen = paletteItems.length > 0;
  useEffect(() => {
    setPaletteIdx(0);
  }, [input]);

  useEffect(() => {
    setScrollOffset(0);
  }, [items.length]);

  const visibleTranscriptRows = synergyEvent
    ? Math.max(1, maxTranscriptRows - synergyEventRows(contentWidth, isCompact))
    : maxTranscriptRows;
  const estimatedTranscriptRows = useMemo(
    () => estimateTranscriptRows(items, isCompact, contentWidth),
    [items, isCompact, contentWidth],
  );
  const scrollHint = useMemo(() => {
    if (estimatedTranscriptRows <= visibleTranscriptRows) return undefined;
    return scrollOffset > 0 ? "PageDown newer" : "PageUp scrollback";
  }, [estimatedTranscriptRows, visibleTranscriptRows, scrollOffset]);

  // throttle streaming updates so React doesn't re-render every token.
  // A single rolling string buffer; `+=` is O(1) amortized per token in
  // V8 (rope concat), whereas array-push + join() rebuilds the full
  // string on every flush (O(n²) over a streaming response).
  const streamBufRef = useRef("");
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const synergyActiveRef = useRef(false);
  const mountedRef = useRef(false);
  const exitingRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const synergyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyDraftRef = useRef<{ value: string; cursor: number } | null>(null);
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
      savePetState(petStatsRef.current);
      // Flush any debounced session write so resume captures the latest
      // turn even if the user quits within the 800ms debounce window.
      flushPersistSession();
      if (streamTimerRef.current !== null) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (synergyTimerRef.current !== null) {
        clearInterval(synergyTimerRef.current);
        synergyTimerRef.current = null;
      }
      requestInFlightRef.current = false;
      synergyActiveRef.current = false;
      setRequestInFlight(false);
      setSynergyEvent(null);
      setExitMsg(msg);
      // Drain the pet save queue before Ink unmounts. The 50ms grace
      // window above was to let the final `setExitMsg` render before
      // alt-screen tears down; we keep that grace as a hard cap by
      // racing the flush against a setTimeout inside flushPetSaves
      // itself (default 2s). On flush completion (or timeout) we then
      // invoke `exit()` so the Ink alt-screen restore still runs.
      replaceExitTimer(
        exitTimerRef,
        () => {
          flushPetSaves().then(
            () => exit(),
            () => exit(),
          );
        },
        50,
      );
    },
    [exit, flushPersistSession],
  );

  const pushTokenToStream = useCallback(
    (t: string, immediate = false) => {
      streamBufRef.current += t;
      // Caller may force an immediate flush for the first token so the
      // user sees a character the instant it arrives; subsequent tokens
      // batch on the 33ms cadence to keep React renders cheap.
      if (immediate) {
        if (streamTimerRef.current !== null) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        flushStream();
        return;
      }
      if (streamTimerRef.current === null) {
        streamTimerRef.current = setTimeout(flushStream, 33);
      }
    },
    [flushStream],
  );

  const runSynergyEvent = useCallback(() => {
    if (synergyTimerRef.current !== null) {
      clearInterval(synergyTimerRef.current);
      synergyTimerRef.current = null;
    }

    const event = pickSynergyEvent();
    let frame = 0;
    const finalFrame = SYNERGY_EVENT_FRAMES - 1;
    const holdFrames = 8;

    setThinking(null);
    setStreaming(null);
    synergyActiveRef.current = true;
    setDeskStatus("idle");
    setDeskNotice("synergy event");
    setSynergyEvent({ event, frame });

    synergyTimerRef.current = setInterval(() => {
      frame += 1;
      if (!mountedRef.current) return;

      if (frame <= finalFrame) {
        setSynergyEvent({ event, frame });
        return;
      }

      if (frame >= finalFrame + holdFrames) {
        if (synergyTimerRef.current !== null) {
          clearInterval(synergyTimerRef.current);
          synergyTimerRef.current = null;
        }
        setSynergyEvent(null);
        synergyActiveRef.current = false;
        setDeskNotice("synergy complete");
        setWitticism(event.finalLine);
        addItem("system", event.transcriptLine);
      }
    }, 45);
  }, [addItem]);

  const runLLM = useCallback(
    async (instruction?: string) => {
      if (requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      setRequestInFlight(true);
      try {
        setThinking(pick(THINKING_LINES));
        setDeskStatus("idle");
        setDeskNotice(null);
        streamBufRef.current = "";
        setStreaming(null);
        let firstToken = true;
        abortRef.current = new AbortController();
        let result: Awaited<ReturnType<typeof streamChat>> | undefined;
        let caughtErr: unknown = null;
        try {
          result = await streamChat({
            apiKey,
            model,
            fallbackModel: pickFallback(model),
            messages: instruction
              ? [
                  ...buildMessagesWithReminder(conversation),
                  { role: "system", content: instruction },
                ]
              : buildMessagesWithReminder(conversation),
            onToken: (t) => {
              if (!mountedRef.current || exitingRef.current) return;
              const isFirst = firstToken;
              if (firstToken) {
                setThinking(null);
                firstToken = false;
              }
              pushTokenToStream(t, isFirst);
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
        if (!mountedRef.current || exitingRef.current) return;
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
        if (cancelledRef.current) {
          cancelledRef.current = false;
          if (result?.content) {
            conversation.push("assistant", result.content);
            addItem("assistant", result.content);
            addItem("system", "(cancelled — Drexler taking lunch)");
            setDeskNotice("response cancelled");
          } else if (firstToken && instruction === undefined) {
            // Aborted before any token arrived. Roll the just-pushed user
            // turn back so the conversation doesn't accumulate dead user
            // messages on repeated quick aborts. Skipped for /retry and
            // /regenerate (instruction !== undefined) — those rerun against
            // an existing user turn we must not pop.
            conversation.popLastUser();
            removeLastUserItem();
            addItem("system", "(cancelled before Drexler started — message withdrawn)");
            setDeskNotice("cancelled before response");
          } else {
            addItem("system", "(cancelled — Drexler taking lunch)");
            setDeskNotice("response cancelled");
          }
        } else if (result?.ok && typeof result.content === "string") {
          conversation.push("assistant", result.content);
          addItem("assistant", result.content);
          const notices: string[] = [];
          if (result.fellBack) {
            addItem("system", `(fell back to ${result.modelUsed})`);
            notices.push(`fallback ${result.modelUsed}`);
          }
          if (detectPersonaDrift(result.content)) {
            addItem("system", `(persona drift detected — model used 'I')`);
            notices.push("persona drift detected");
          }
          setDeskNotice(notices.length > 0 ? notices.join(" · ") : null);
        } else if (result?.interrupted) {
          // V8: do not append partial assistant text. Surface STREAM_ERROR.
          const detail = result.error ? ` [${result.error}]` : "";
          addItem("system", `${STREAM_ERROR}${detail}`);
          setDeskStatus("error");
          setDeskNotice("stream interrupted — /retry to re-roll");
        } else if (result?.authFailure) {
          addItem(
            "system",
            `${result.error ?? "API key rejected by OpenRouter."} Run /auth to enter a new key without restarting.`,
          );
          setDeskStatus("error");
          setDeskNotice("API key rejected — /auth to re-enter");
        } else {
          const detail = result?.error ? ` [${result.error}]` : "";
          addItem("system", `${STREAM_ERROR}${detail}`);
          setDeskStatus("error");
          setDeskNotice(result?.error ?? "stream error");
        }
        setMsgCount(conversation.length);
        setWitticism(pick(WITTICISMS));
        // Persist after every turn outcome so a crash never costs more
        // than the last assistant response. Best-effort; failures are
        // swallowed inside saveSession.
        persistSession();
      } finally {
        requestInFlightRef.current = false;
        if (mountedRef.current) {
          setRequestInFlight(false);
        }
      }
    },
    [
      apiKey,
      model,
      fetchFn,
      addItem,
      conversation,
      pushTokenToStream,
      removeLastUserItem,
      persistSession,
    ],
  );

  const handleSlashWithMutation = useCallback(
    async (line: string): Promise<void> => {
      const lower = line.toLowerCase().trim();
      const [slashCommand = lower] = lower.split(/\s+/, 1);

      // Pet commands — handled before dispatch so they don't hit the unknown-command path
      if (lower === "/synergy") {
        runSynergyEvent();
        return;
      }
      if (slashCommand === "/pet") {
        const arg = lower.slice("/pet".length).trim();
        if (arg === "") {
          const next = !petModeRef.current;
          setDashboardPetMode(next);
          addItem(
            "system",
            next
              ? "Pet dashboard enabled. Deal desk converted to habitat."
              : "Pet dashboard disabled. Deal desk restored.",
          );
          return;
        }
        if (arg === "on" || arg === "off") {
          const next = arg === "on";
          const changed = petModeRef.current !== next;
          setDashboardPetMode(next);
          addItem(
            "system",
            changed
              ? next
                ? "Pet dashboard enabled. Deal desk converted to habitat."
                : "Pet dashboard disabled. Deal desk restored."
              : next
                ? "Pet dashboard already enabled."
                : "Pet dashboard already disabled.",
          );
          return;
        }
        addItem("system", "Usage: /pet, /pet on, or /pet off.");
        return;
      }
      const isPetCommand =
        slashCommand === "/feed" ||
        slashCommand === "/play" ||
        slashCommand === "/work" ||
        slashCommand === "/praise" ||
        slashCommand === "/rest" ||
        slashCommand === "/vibe";
      if (isPetCommand && isDead) {
        addItem(
          "system",
          "Drexler is in HR. Restructuring paperwork pending — try again after revival.",
        );
        return;
      }
      const cooldownAction: PetActionKey | null =
        slashCommand === "/feed"
          ? "feed"
          : slashCommand === "/play"
            ? "play"
            : slashCommand === "/work"
              ? "work"
              : slashCommand === "/praise"
                ? "praise"
                : slashCommand === "/rest"
                  ? "rest"
                  : slashCommand === "/vibe"
                    ? "vibe"
                    : null;
      if (cooldownAction !== null) {
        const cd = actionCooldown(petStatsRef.current, cooldownAction);
        if (!cd.ok) {
          addItem(
            "system",
            `Drexler ${cooldownAction === "feed" ? "just ate" : cooldownAction === "play" ? "just played" : cooldownAction === "work" ? "just worked" : cooldownAction === "praise" ? "just got praised" : cooldownAction === "rest" ? "just rested" : "just vibed"}. Wait ${formatCooldownRemaining(cd.remainingMs)} before the next attempt. Drexler resents micromanagement.`,
          );
          return;
        }
      }
      if (slashCommand === "/feed") {
        applyPetAction("feed", applyFeed);
        triggerPetActivity("eating", 3500);
        addItem("system", pick(PET_MESSAGES.feed));
        return;
      }
      if (slashCommand === "/play") {
        applyPetAction("play", applyPlay);
        triggerPetActivity("playing", 4000);
        addItem("system", pick(PET_MESSAGES.play));
        return;
      }
      if (slashCommand === "/work") {
        applyPetAction("work", applyWork);
        triggerPetActivity("working", 5000);
        addItem("system", pick(PET_MESSAGES.work));
        return;
      }
      if (slashCommand === "/praise") {
        applyPetAction("praise", applyPraise);
        triggerPetActivity("praised", 3000);
        addItem("system", pick(PET_MESSAGES.praise));
        return;
      }
      if (slashCommand === "/rest") {
        applyPetAction("rest", applyRest);
        triggerPetActivity("sleeping", 5000);
        addItem("system", pick(PET_MESSAGES.rest));
        return;
      }
      if (slashCommand === "/vibe") {
        // Roll once outside the reducer so StrictMode's double-invoke
        // takes the same branch both times. The reducer reads the latest
        // committed stats so a racing decay tick can't be clobbered in
        // the stats update. Message text is derived from the pre-action
        // snapshot — in the rare race window where a decay tick lands
        // between snapshot and dispatch, the message describes pre-decay
        // stats while the committed stats reflect post-decay+vibe. Cost
        // of a fully race-free message is a non-pure reducer, which is
        // not worth it for a satirical chat affordance.
        const roll = Math.random();
        const { message: vibeMessage } = applyVibe(petStatsRef.current, roll);
        applyPetAction("vibe", (stats) => applyVibe(stats, roll).stats);
        triggerPetActivity("vibing", 3500);
        addItem("system", vibeMessage);
        return;
      }
      if (slashCommand === "/name") {
        const arg = line.slice("/name".length).trim();
        if (arg.length === 0) {
          const current = petStatsRef.current.name;
          addItem(
            "system",
            current
              ? `Drexler's pet name on file: "${current}". /name <new> to reassign.`
              : "No pet name on file. /name <name> to issue corporate identity.",
          );
          return;
        }
        const cleaned = sanitizePetName(arg);
        if (cleaned.length === 0) {
          addItem(
            "system",
            "Drexler refuses unprintable identity. Pick letters, numbers, spaces, dots, or apostrophes (≤16 chars).",
          );
          return;
        }
        updatePetStats((s) => applyName(s, cleaned));
        addItem("system", `Pet renamed: "${cleaned}". Memo distributed to all departments.`);
        return;
      }
      if (slashCommand === "/auth") {
        const arg = line.slice("/auth".length).trim();
        if (arg.length === 0) {
          addItem(
            "system",
            "Drexler refuses to take dictation. Type `/auth <key>` to replace the in-session API key. Key is masked in the panel but echoed in your shell scrollback — clear that line afterward.",
          );
          return;
        }
        const candidate = arg.trim();
        if (!isValidApiKey(candidate)) {
          addItem(
            "system",
            "That doesn't look like a valid OpenRouter API key (length < 20 or placeholder).",
          );
          return;
        }
        setApiKey(candidate);
        try {
          await saveConfig({ apiKey: candidate });
          addItem(
            "system",
            "API key updated and saved. The next request uses it without restarting.",
          );
          setDeskStatus("idle");
          setDeskNotice("API key updated");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          addItem(
            "system",
            `In-session key set, but persistence failed: ${msg}. Next launch will fall back to the prior key.`,
          );
          setDeskStatus("error");
          setDeskNotice("key persist failed");
        }
        return;
      }
      if (slashCommand === "/profile") {
        const s = petStatsRef.current;
        const tenure = formatTenure(petTenureMs(s));
        const mood = getPetMood(s);
        const stats = [
          ["hunger", s.hunger],
          ["happiness", s.happiness],
          ["energy", s.energy],
          ["deals", s.deals],
        ] as const;
        const dominant = stats.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
        const rank = getPetRank(s);
        const lines = [
          "Drexler personnel file:",
          `  name      : ${s.name ?? "(unnamed associate)"}`,
          `  rank      : ${rankLabel(rank)}`,
          `  tenure    : ${tenure}`,
          `  mood      : ${mood}`,
          `  hunger    : ${Math.round(s.hunger)}%`,
          `  happiness : ${Math.round(s.happiness)}%`,
          `  energy    : ${Math.round(s.energy)}%`,
          `  deals     : ${Math.round(s.deals)}%`,
          `  standout  : ${dominant[0]} (${Math.round(dominant[1])}%)`,
        ];
        addItem("system", lines.join("\n"));
        return;
      }

      let captured = "";
      const mutableConfig: Config = { ...config, model };
      const action = dispatch(line, {
        conversation,
        config: mutableConfig,
        print: (s) => {
          captured += (captured ? "\n" : "") + s;
        },
      });
      if (lower === "/clear" || lower.startsWith("/clear ")) {
        setItems([]);
      }
      if (mutableConfig.model !== model) {
        setModel(mutableConfig.model);
      }
      const appliedTheme = lower.startsWith("/theme ") && captured.includes("redecorate boardroom");
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
      if (action.type === "draft") {
        updateDraft({
          value: action.value,
          cursor: graphemeLength(action.value),
        });
      }
      if (action.type === "debug") {
        const frames = getRecentTelemetry();
        if (frames.length === 0) {
          addItem("system", "Drexler telemetry buffer empty. No stream attempts on record.");
        } else {
          const lines = ["Drexler stream telemetry (last 5):"];
          for (const f of frames) {
            const ts = new Date(f.at).toISOString().slice(11, 19);
            const verdict = f.ok ? "ok" : "err";
            const status = f.status ?? "-";
            const dur = typeof f.durationMs === "number" ? `${f.durationMs}ms` : "-";
            const err = f.error ? ` ${f.error}` : "";
            lines.push(`  [${ts}] ${f.model} ${verdict} ${status} ${dur}${err}`);
          }
          addItem("system", lines.join("\n"));
        }
      }
      setMsgCount(conversation.length);
    },
    [
      addItem,
      activeTheme,
      applyPetAction,
      config,
      conversation,
      isDead,
      model,
      PET_MESSAGES,
      removeLastAssistantItem,
      runLLM,
      runSynergyEvent,
      setDashboardPetMode,
      triggerExit,
      triggerPetActivity,
      updateDraft,
      updatePetStats,
    ],
  );

  const onSubmit = useCallback(
    async (raw: string) => {
      if (requestInFlightRef.current || synergyActiveRef.current) return;
      const line = raw.trim();
      if (line === "") {
        addItem("system", EMPTY_NUDGE);
        return;
      }
      if (isSlash(line)) {
        // Bare /theme, /model, /startup, /retry, /export — repopulate the
        // input with "<cmd> " so the palette catches the argument chooser
        // and the user picks via ↑↓ + Enter. Avoids the "print current
        // value and dead-end" feeling of dispatching the base command.
        const lower = line.toLowerCase();
        if (isArgumentParentCommand(lower)) {
          const filled = `${lower} `;
          updateDraft({ value: filled, cursor: graphemeLength(filled) });
          setPaletteIdx(0);
          addItem(
            "system",
            `Pick a ${lower.slice(1)} option below — ↑↓ to choose, Enter to apply, Esc to cancel.`,
          );
          return;
        }
        await handleSlashWithMutation(line);
        return;
      }
      addItem("user", line);
      conversation.push("user", line);
      setMsgCount(conversation.length);
      await runLLM();
    },
    [addItem, conversation, handleSlashWithMutation, runLLM, setPaletteIdx, updateDraft],
  );

  const reportSubmitError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      addItem("system", `${STREAM_ERROR} [${msg}]`);
      setDeskStatus("error");
      setDeskNotice("submit failed");
    },
    [addItem],
  );

  useInput((char, key) => {
    // Scroll keys are always live — they only mutate scrollOffset and never
    // commit input, so we let the user review history during streaming.
    if (key.pageUp) {
      setScrollOffset((offset) =>
        nextTranscriptScrollOffset({
          current: offset,
          totalRows: estimatedTranscriptRows,
          visibleRows: visibleTranscriptRows,
          direction: "older",
        }),
      );
      return;
    }
    if (key.pageDown) {
      setScrollOffset((offset) =>
        nextTranscriptScrollOffset({
          current: offset,
          totalRows: estimatedTranscriptRows,
          visibleRows: visibleTranscriptRows,
          direction: "newer",
        }),
      );
      return;
    }
    const busy =
      requestInFlightRef.current ||
      synergyActiveRef.current ||
      streaming !== null ||
      thinking !== null ||
      synergyEvent !== null;
    if (busy) {
      if (key.escape) {
        if (synergyActiveRef.current || synergyEvent !== null) {
          return;
        }
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
    if (key.return) {
      // Shift+Enter (Kitty/iTerm2/Windows Terminal) and Alt+Enter
      // (universal) insert a literal newline at the cursor so the
      // user can compose multi-line prompts without leaving the input.
      // Plain Enter submits as before.
      if (key.shift || key.meta) {
        updateDraft((prev) =>
          insertAtCursor(prev.value, clampCursor(prev.value, prev.cursor), "\n"),
        );
        return;
      }
      if (paletteOpen) {
        const sel = paletteItems[paletteIdx];
        if (sel) {
          // Bare /theme, /model, etc. — open the chooser, do not execute.
          if (isArgumentParentCommand(sel.name)) {
            const filled = sel.name + " ";
            updateDraft({
              value: filled,
              cursor: graphemeLength(filled),
            });
            setPaletteIdx(0);
            return;
          }
          updateDraft({ value: "", cursor: 0 });
          setHistoryIdx(null);
          historyDraftRef.current = null;
          onSubmit(sel.name).catch((err) => {
            reportSubmitError(err);
          });
        }
        return;
      }
      const submitted = draftRef.current.value;
      updateDraft({ value: "", cursor: 0 });
      setHistoryIdx(null);
      historyDraftRef.current = null;
      const trimmedSubmit = submitted.trim();
      if (trimmedSubmit.length > 0) {
        setHistory((prev) => {
          const next = [...prev, trimmedSubmit];
          return next.length > 50 ? next.slice(-50) : next;
        });
      }
      onSubmit(submitted).catch((err) => {
        reportSubmitError(err);
      });
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
        setPaletteIdx((i) => (i - 1 + paletteItems.length) % paletteItems.length);
        return;
      }
      if (history.length === 0) return;
      const next = historyNavStep(
        {
          historyIdx,
          draft: draftRef.current,
          historyDraft: historyDraftRef.current,
        },
        history,
        "up",
      );
      historyDraftRef.current = next.historyDraft;
      setHistoryIdx(next.historyIdx);
      updateDraft(next.draft);
      return;
    }
    if (key.downArrow) {
      if (paletteOpen) {
        setPaletteIdx((i) => (i + 1) % paletteItems.length);
        return;
      }
      if (historyIdx === null) return;
      const next = historyNavStep(
        {
          historyIdx,
          draft: draftRef.current,
          historyDraft: historyDraftRef.current,
        },
        history,
        "down",
      );
      historyDraftRef.current = next.historyDraft;
      setHistoryIdx(next.historyIdx);
      updateDraft(next.draft);
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
    // Plain text input. Filter out control chars except printable +
    // newline (so multi-line paste survives).
    if (!key.ctrl && !key.meta && char) {
      // Normalize CRLF / CR → LF first, then strip every other control
      // byte. LF (0x0a) survives so pasted multi-line text renders as
      // multiple lines in the input.
      const normalized = char.replace(/\r\n?/g, "\n");
      // intentional: strip ANSI/control chars
      // eslint-disable-next-line no-control-regex
      const filtered = normalized.replace(/[\x00-\x09\x0b-\x1f]/g, "");
      if (filtered.length > 0) {
        updateDraft((prev) =>
          insertAtCursor(prev.value, clampCursor(prev.value, prev.cursor), filtered),
        );
      }
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    // Capture timer refs themselves (stable across renders); reading
    // `.current` at cleanup time is intentional — we clear whatever
    // timer is live at unmount, not a snapshot from mount when refs
    // were null. Refs are stable so closing over them is safe.
    const streamTimer = streamTimerRef;
    const exitTimer = exitTimerRef;
    const synergyTimer = synergyTimerRef;
    const requestInFlight = requestInFlightRef;
    const synergyActive = synergyActiveRef;
    const mounted = mountedRef;
    const abort = abortRef;
    const conversationLatest = conversationRef;
    const modelLatest = modelRef;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      if (persistDebouncer.hasPending()) {
        // Flush any pending debounced write so the next launch sees
        // the latest turn; best-effort, the promise is fire-and-forget.
        const currentConversation = conversationLatest.current;
        persistDebouncer.cancel();
        void saveSession(
          buildSavedSession(
            currentConversation,
            currentConversation.systemPrompt,
            modelLatest.current,
          ),
        ).catch(() => {});
      }
      // Drain the pet save queue on unmount so any in-flight
      // `savePetState` (from a final stat tick or activity) lands on
      // disk before the process tears down. Fire-and-forget: React
      // effect cleanup can't await, and `flushPetSaves` enforces its
      // own ≤2s timeout.
      void flushPetSaves().catch(() => {});
      if (streamTimer.current !== null) {
        clearTimeout(streamTimer.current);
      }
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
      }
      if (synergyTimer.current !== null) {
        clearInterval(synergyTimer.current);
      }
      requestInFlight.current = false;
      synergyActive.current = false;
    };
  }, [persistDebouncer]);

  const isBusy =
    requestInFlight || streaming !== null || thinking !== null || synergyEvent !== null;
  const headerStatus = isBusy ? "streaming" : deskStatus;
  const renderDealDeskHeader = useCallback(
    (width: number, marginBottom = 1) => (
      <DealDeskHeader
        mood={mood}
        messageCount={msgCount}
        status={headerStatus}
        compact={isCompact}
        notice={!introActive ? (deskNotice ?? undefined) : undefined}
        maxWidth={Math.max(1, width)}
        marginBottom={marginBottom}
      />
    ),
    [mood, msgCount, headerStatus, isCompact, introActive, deskNotice],
  );
  const dealDeskHeader = renderDealDeskHeader(chromeWidth);
  const introBarColor = introPhaseColor(intro.colorPhase, t);

  if (isDead) {
    return (
      <ThemeProvider value={activeTheme}>
        <DeathScreen reason={deathReason} variant={deathVariant} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={activeTheme}>
      <Box flexDirection="column">
        {showFullDashboard && typeof greeting === "string" ? (
          <Box marginBottom={1}>
            <MascotDashboard
              greeting={greeting}
              width={chromeWidth}
              mood={mood}
              mode={petMode && !introActive ? "pet" : "normal"}
              petStats={petStats}
              petActivity={petActivity}
              petEnv={petEnv}
              petPaused={isBusy}
              bootProgress={introActive ? intro.progress : 1}
              state={introActive ? intro.state : undefined}
              bar={introActive ? intro.bar : undefined}
              barColor={introActive ? introBarColor : undefined}
              mascotStatus={introActive ? intro.status : undefined}
              dealDesk={(width) => renderDealDeskHeader(width, 0)}
            />
          </Box>
        ) : showFallbackPetPanel ? (
          <Box marginBottom={1}>
            <CompactPetPanel
              stats={petStats}
              activity={petActivity}
              env={petEnv}
              isPaused={isBusy}
              width={chromeWidth}
            />
          </Box>
        ) : (
          dealDeskHeader
        )}
        <Box flexDirection="row" alignItems="flex-start">
          <Box flexDirection="column" flexGrow={1}>
            <TranscriptViewport
              items={items}
              maxRows={visibleTranscriptRows}
              cols={contentWidth}
              compact={isCompact}
              scrollOffset={scrollOffset}
            />
            <Box flexDirection="column">
              {streaming !== null && (
                <Box marginBottom={1}>
                  <StreamingMessage content={streaming} width={contentWidth} />
                </Box>
              )}
              {thinking !== null && streaming === null && (
                <Box marginBottom={1}>
                  <Spinner label={thinking} width={contentWidth} />
                </Box>
              )}
              {synergyEvent !== null && (
                <SynergyEvent
                  event={synergyEvent.event}
                  frame={synergyEvent.frame}
                  width={contentWidth}
                  compact={isCompact}
                />
              )}
              {exitMsg !== null ? (
                <Box paddingX={2} marginBottom={1}>
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
                      width={contentWidth}
                    />
                  )}
                  <Box flexDirection="column">
                    <InputBox
                      value={input}
                      cursor={cursor}
                      disabled={isBusy}
                      disabledLabel={
                        synergyEvent !== null
                          ? "(Synergy event running... boardroom locked)"
                          : undefined
                      }
                      width={contentInputWidth}
                    />
                  </Box>
                  <StatusBar
                    messageCount={msgCount}
                    witticism={witticism}
                    maxWidth={contentInputWidth}
                    status={isBusy ? "streaming" : deskStatus}
                    compact={isCompact}
                    scrollHint={scrollHint}
                  />
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
