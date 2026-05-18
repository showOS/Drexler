import { Box, Text, useApp, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  appendActionHistory,
  achievementProgressOf,
  flushPetSaves,
  formatCooldownRemaining,
  formatTenure,
  getPetMood,
  getPetRank,
  isPetDead,
  loadPetState,
  petTenureMs,
  rankLabel,
  recordHealthyProgress,
  recordSynergyProgress,
  recordWorldSeen,
  recordWorldSurvived,
  sanitizePetName,
  savePetState,
  stampAction,
  type PetActionKey,
  type PetActivity,
  type PetStats,
} from "../pet/petState.ts";
import {
  applyEventCancel,
  applyEventChoice,
  applyEventExpire,
  defaultScheduler as defaultEventScheduler,
  EVENT_POOL,
  isEventExpired,
  spawnEvent,
  type EventScheduler,
  type PetEvent,
} from "../pet/events.ts";
import {
  defaultDealScheduler,
  formatDeal,
  maybeOfferDeal,
  shouldGuaranteeDailyDeal,
  tickDeals,
  type DealScheduler,
} from "../pet/deals.ts";
import { detectSynergy } from "../pet/synergy.ts";
import { attemptTrade, parseSide, parseTicker, type Ticker } from "../pet/trade.ts";
import { buyItem, parseInventoryItem, useItem as consumeInventoryItem } from "../pet/inventory.ts";
import { appendGraveyardEntry, buildGraveyardEntry } from "../pet/graveyard.ts";
import {
  bumpDealsClosed,
  bumpEventsSurvived,
  buildReviewSnapshot,
  ensureReviewCounters,
  evaluateReviewGate,
  formatReview,
  markReviewShown,
} from "../pet/review.ts";
import { buildPetSummary, injectPetSummary } from "../pet/personaSummary.ts";
import { appendNotification, clearNotifications } from "../pet/notificationLog.ts";
import {
  isAchievementUnlocked,
  unlockAchievement,
  type AchievementId,
} from "../pet/achievements.ts";
import {
  grantPerkPointOnPromotion,
  parsePerkId,
  perkCooldownReductionMs,
  perkDecayMultiplier,
  perkFeedMultiplier,
  perkChartered,
  perkTradeEye,
  perkPipelineCap,
  perkSynergyMultiplier,
  spendPerkPoint,
} from "../pet/perks.ts";
import { archetypeMultipliers, chooseArchetype, renderArchetypes } from "../pet/archetype.ts";
import { bumpDailyChallenge, bumpStreakForAction, ensureDailyChallenge } from "../pet/streaks.ts";
import {
  defaultWorldScheduler,
  expireWorldEvent,
  maybeSpawnWorldEvent,
  worldDecayMultiplier,
  worldEventGapMultiplier,
  worldTradeLossMultiplier,
  worldWorkDealMultiplier,
  type WorldScheduler,
} from "../pet/world.ts";
import {
  canStartPitch,
  openNegotiate,
  resolveNegotiate,
  resolvePitch,
  type NegotiateScenario,
} from "../pet/minigames.ts";
import { BOSS_QUARTERLY, advanceBoss, bossNeedsAudit, startBoss } from "../pet/boss.ts";
import { bumpAgenda, bumpAgendaForAction, ensureAgenda } from "../pet/agenda.ts";
import { defaultRng, pickInt } from "../pet/rng.ts";
import { handlePetViewSlash } from "./pet/petViewCommands.ts";
import type { Attachment } from "../attach/types.ts";
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from "../attach/types.ts";
import {
  buildTextAttachmentBlock,
  loadAttachment,
  loadAttachmentFromBuffer,
  shortSha as attShortSha,
} from "../attach/loader.ts";
import {
  classifyPaste,
  isLikelyDroppedPath,
  parseMultiFileDrop,
  splitBracketedPaste,
  unquoteDroppedPath,
} from "../attach/intake.ts";
import { pushRecent } from "../attach/recent.ts";
import type { AttachmentChip } from "./InputBox.tsx";

// V60/T43 — single helper that composes the four sources that scale
// stat decay so both the action-commit path and the 60s tick use the
// same math + ordering (V58: base × perk × archetype × world). Cheap
// to call (constant-time over the stats record); not worth wrapping
// in useMemo because the function is invoked from event handlers and
// timer callbacks that read `petStatsRef.current` directly.
function composeDecayMultiplier(stats: PetStats, now: number): number {
  return Math.min(
    1,
    sessionDecayMultiplier(stats, now) *
      perkDecayMultiplier(stats) *
      worldDecayMultiplier(stats, now) *
      archetypeMultipliers(stats).decay,
  );
}
import { sessionDecayMultiplier } from "../pet/petState.ts";
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
import { banner as fullBanner, pickLayout, tagline } from "../renderer.ts";
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

// Local pick helper — accepts an optional RNG (V66) so tests can stub
// the choice. The default-parameter slot is the only place inline
// Math.random is permitted at a use site.
function pick<T>(arr: readonly T[], rng: () => number = Math.random): T {
  if (arr.length === 0) {
    throw new Error("pick called on empty array");
  }
  const idx = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  return arr[idx] as T;
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
  registerGracefulExitHandler?: (handler: (() => void) | null) => void;
  clearScreenForIntroOutro?: () => void;
}

interface ChromePaneProps {
  showFullDashboard: boolean;
  showFallbackPetPanel: boolean;
  greeting?: string;
  chromeWidth: number;
  mood: string;
  petMode: boolean;
  introActive: boolean;
  petStats: PetStats;
  petActivity: PetActivity;
  petEnv: Environment;
  isBusy: boolean;
  introProgress: number;
  introState?: ReturnType<typeof useIntroAnimation>["state"];
  introBar?: ReturnType<typeof useIntroAnimation>["bar"];
  introBarColor?: string;
  introStatus?: string;
  dealDeskHeader: ReactNode;
  dealDesk: (width: number) => ReactNode;
}

const IntroChrome = memo(function IntroChrome() {
  const allRows = useMemo(() => fullBanner().split("\n"), []);
  const taglineText = useMemo(() => tagline(), []);
  const [shownRows, setShownRows] = useState(0);
  useEffect(() => {
    if (shownRows >= allRows.length) return;
    const handle = setTimeout(() => setShownRows((n) => Math.min(n + 1, allRows.length)), 60);
    return () => clearTimeout(handle);
  }, [shownRows, allRows.length]);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {allRows.slice(0, shownRows).map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {shownRows >= allRows.length && <Text>{taglineText}</Text>}
    </Box>
  );
});

const ChromePane = memo(function ChromePane({
  showFullDashboard,
  showFallbackPetPanel,
  greeting,
  chromeWidth,
  mood,
  petMode,
  introActive,
  petStats,
  petActivity,
  petEnv,
  isBusy,
  introProgress,
  introState,
  introBar,
  introBarColor,
  introStatus,
  dealDeskHeader,
  dealDesk,
}: ChromePaneProps) {
  if (showFullDashboard && typeof greeting === "string") {
    return (
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
          bootProgress={introActive ? introProgress : 1}
          state={introActive ? introState : undefined}
          bar={introActive ? introBar : undefined}
          barColor={introActive ? introBarColor : undefined}
          mascotStatus={introActive ? introStatus : undefined}
          dealDesk={dealDesk}
        />
      </Box>
    );
  }

  if (showFallbackPetPanel) {
    return (
      <Box marginBottom={1}>
        <CompactPetPanel
          stats={petStats}
          activity={petActivity}
          env={petEnv}
          isPaused={isBusy}
          width={chromeWidth}
        />
      </Box>
    );
  }

  return dealDeskHeader;
});

export function App({
  conversation,
  config,
  mood = "neutral",
  fetchFn,
  greeting,
  showIntroChrome = false,
  introInitiallyDone = false,
  registerGracefulExitHandler,
  clearScreenForIntroOutro,
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

  const [items, setItems] = useState<ChatItem[]>(() => {
    const snap = conversation.snapshot();
    const turns = snap.filter((m) => m.role === "user" || m.role === "assistant");
    return turns.map((m, i) => ({
      id: i + 1,
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  });
  const itemIdRef = useRef(items.length);
  const addItem = useCallback((role: ChatItem["role"], content: string) => {
    const id = itemIdRef.current + 1;
    itemIdRef.current = id;
    setItems((prev) => [...prev, { id, role, content }]);
  }, []);
  const removeLastAssistantItem = useCallback(() => {
    setItems((prev) => {
      const idx = prev.findLastIndex((item) => item.role === "assistant");
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
  const [pendingAttachments, setPendingAttachments] = useState<readonly Attachment[]>([]);
  const pendingAttachmentsRef = useRef<readonly Attachment[]>(pendingAttachments);
  const pasteArmedRef = useRef(false);

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

  const setAttachments = useCallback((next: readonly Attachment[]) => {
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }, []);

  const clearAttachments = useCallback(() => {
    if (pendingAttachmentsRef.current.length === 0) return;
    setAttachments([]);
  }, [setAttachments]);

  const formatBytesShort = useCallback((n: number): string => {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  }, []);

  const tryAttach = useCallback(
    (att: Attachment): { ok: true } | { ok: false; reason: string } => {
      const current = pendingAttachmentsRef.current;
      if (current.length >= MAX_ATTACHMENTS) {
        return { ok: false, reason: `Attachment slots full (${MAX_ATTACHMENTS} max).` };
      }
      if (current.some((a) => a.sha256 === att.sha256)) {
        return { ok: false, reason: `Already attached: ${att.filename}.` };
      }
      const total = current.reduce((sum, a) => sum + a.sizeBytes, 0) + att.sizeBytes;
      if (total > MAX_TOTAL_BYTES) {
        return {
          ok: false,
          reason: `Attachment total ${formatBytesShort(total)} > ${formatBytesShort(MAX_TOTAL_BYTES)}.`,
        };
      }
      setAttachments([...current, att]);
      return { ok: true };
    },
    [setAttachments, formatBytesShort],
  );
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
    // Reset Ink's log-update cache via instance.clear() AND wipe the pre-Ink
    // banner/tagline/resume lines before flipping introDone. Writing the clear
    // escape via useStdout() alone leaves log-update's previousOutput stale —
    // the post-flip frame is near-identical to the last intro frame so
    // log-update's diff check skips the write and the terminal stays blank.
    clearScreenForIntroOutro?.();
    setIntroDone(true);
  }, [clearScreenForIntroOutro]);
  const intro = useIntroAnimation(chromeWidth, introActive, handleIntroComplete);

  const [petStats, setPetStats] = useState<PetStats>(() => loadPetState());
  const [petActivity, setPetActivity] = useState<PetActivity>("idle");
  const [isDead, setIsDead] = useState(false);
  const [deathReason, setDeathReason] = useState("energy");
  const [deathVariant, setDeathVariant] = useState(0);
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null);
  const [eventScheduleNonce, setEventScheduleNonce] = useState(0);
  const petStatsRef = useRef<PetStats>(petStats);
  const petActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const petDecayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const explicitPetSavePendingRef = useRef(false);
  const lastPetSaveNoticeAtRef = useRef(0);
  const eventSpawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextEventDueAtRef = useRef<number | null>(null);
  const dealSchedulerRef = useRef<DealScheduler>(defaultDealScheduler());
  const eventSchedulerRef = useRef<EventScheduler>(defaultEventScheduler());
  const worldSchedulerRef = useRef<WorldScheduler>(defaultWorldScheduler());
  const activeEventRef = useRef<PetEvent | null>(null);
  const dailyReviewShownThisLaunchRef = useRef(false);
  const activeNegotiateRef = useRef<{ scenario: NegotiateScenario; startedAt: number } | null>(
    null,
  );
  const negotiateExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeNegotiate, setActiveNegotiate] = useState<{
    scenario: NegotiateScenario;
    startedAt: number;
  } | null>(null);
  const pitchStartedAtRef = useRef<number | null>(null);
  const [pitchActive, setPitchActive] = useState(false);
  const [pitchFrame, setPitchFrame] = useState(0);
  const pitchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const unlockBadge = useCallback(
    (id: AchievementId, narrationBuffer: string[], now: number, silent = false) => {
      const r = unlockAchievement(id, now);
      if (!r.ok) return;
      const msg = `Badge unlocked: ${r.def.title} — ${r.def.description}`;
      appendNotification("badge", msg, now);
      if (silent) return;
      narrationBuffer.push(msg);
      addItem("system", msg);
    },
    [addItem],
  );
  const eventGapFrom = useCallback((stats: PetStats, now: number) => {
    if (bossNeedsAudit(stats, now) && typeof stats.boss?.forcedAuditAt === "number") {
      return Math.max(0, stats.boss.forcedAuditAt - now);
    }
    const effective = Math.round(
      eventSchedulerRef.current.pickGap() * worldEventGapMultiplier(stats, now),
    );
    return Math.max(6 * 60_000, effective);
  }, []);
  const scheduleNextEventFrom = useCallback(
    (endedAt: number, stats: PetStats = petStatsRef.current) => {
      nextEventDueAtRef.current = endedAt + eventGapFrom(stats, endedAt);
    },
    [eventGapFrom],
  );
  const evaluateProgressBadges = useCallback(
    (stats: PetStats, narration: string[], now: number) => {
      const progress = achievementProgressOf(stats, now);
      if (progress.pipelineCompletions >= 25 && !isAchievementUnlocked("pipeline_pro")) {
        unlockBadge("pipeline_pro", narration, now);
      }
      if (progress.synergyIds.length >= 3 && !isAchievementUnlocked("synergy_3")) {
        unlockBadge("synergy_3", narration, now);
      }
      if (progress.tradeWins >= 10 && !isAchievementUnlocked("trade_winner_10")) {
        unlockBadge("trade_winner_10", narration, now);
      }
      if (progress.auditEventsSurvived >= 5 && !isAchievementUnlocked("audit_survivor_5")) {
        unlockBadge("audit_survivor_5", narration, now);
      }
      if (progress.chartersUsed >= 3 && !isAchievementUnlocked("chartered_3")) {
        unlockBadge("chartered_3", narration, now);
      }
      if (progress.pitchHits >= 5 && !isAchievementUnlocked("pitch_perfect")) {
        unlockBadge("pitch_perfect", narration, now);
      }
      if (progress.negotiateWins >= 5 && !isAchievementUnlocked("negotiator")) {
        unlockBadge("negotiator", narration, now);
      }
      if (
        progress.healthySince !== undefined &&
        now - progress.healthySince >= 24 * 60 * 60_000 &&
        !isAchievementUnlocked("iron_will")
      ) {
        unlockBadge("iron_will", narration, now);
      }
      if (
        progress.respawned &&
        getPetRank(stats) === "vp" &&
        !isAchievementUnlocked("comeback_kid")
      ) {
        unlockBadge("comeback_kid", narration, now);
      }
      if (
        progress.survivedWorldEvents.includes("market_crash") &&
        !isAchievementUnlocked("world_survivor")
      ) {
        unlockBadge("world_survivor", narration, now);
      }
      if (progress.seenWorldEvents.includes("holiday") && !isAchievementUnlocked("world_party")) {
        unlockBadge("world_party", narration, now);
      }
    },
    [unlockBadge],
  );
  const setDashboardPetMode = useCallback(
    (next: boolean) => {
      petModeRef.current = next;
      setPetMode(next);
      if (!next) return;
      // Coming online: roll today's daily challenge and consider spawning
      // a world event. Both are idempotent within the day.
      const now = Date.now();
      const agenda = ensureAgenda(petStatsRef.current, now);
      let nextStats = agenda.stats;
      if (agenda.dailyFresh && nextStats.agenda) {
        addItem("system", "Today's agenda ready. Run /agenda for mandates and next action.");
      }
      const dc = ensureDailyChallenge(nextStats, now);
      nextStats = dc.stats;
      if (dc.freshly && nextStats.dailyChallenge) {
        const msg = `Today's challenge: ${nextStats.dailyChallenge.kind} (target ${nextStats.dailyChallenge.target}).`;
        appendNotification("challenge", msg, now);
        addItem("system", msg);
      }
      const world = maybeSpawnWorldEvent(nextStats, now, worldSchedulerRef.current);
      nextStats = world.stats;
      if (world.spawned) {
        nextStats = recordWorldSeen(nextStats, world.spawned.kind, now);
        const msg = `${world.spawned.title} — ${world.spawned.description}`;
        appendNotification("world", msg, now);
        addItem("system", msg);
        evaluateProgressBadges(nextStats, [], now);
      }
      if (nextEventDueAtRef.current === null) {
        scheduleNextEventFrom(now, nextStats);
      }
      if (nextStats !== petStatsRef.current) {
        explicitPetSavePendingRef.current = true;
        const stamped = { ...nextStats, lastSaved: now };
        petStatsRef.current = stamped;
        setPetStats(() => stamped);
      }
    },
    [addItem, evaluateProgressBadges, scheduleNextEventFrom],
  );
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
      // Precompute the next state from the latest committed stats (mirror'd
      // in petStatsRef) so narration can fire exactly once per click. Folds
      // decay, action stamp, streak, daily-challenge, deals tick, synergy,
      // boss advance, and achievement checks in a single deterministic pass.
      const now = Date.now();
      const archetype = archetypeMultipliers(petStatsRef.current);
      const decayMult = composeDecayMultiplier(petStatsRef.current, now);
      const decayed = applyDecay(petStatsRef.current, now, decayMult);
      const guaranteeDailyDeal = action === "work" && shouldGuaranteeDailyDeal(decayed, now);
      let next: PetStats = mutator(decayed);
      if (action === "feed") {
        const mealMult = perkFeedMultiplier(decayed);
        if (mealMult > 1) {
          next = {
            ...next,
            hunger: Math.min(100, decayed.hunger + (next.hunger - decayed.hunger) * mealMult),
            happiness: Math.min(
              100,
              decayed.happiness + (next.happiness - decayed.happiness) * mealMult,
            ),
            deals: Math.min(100, decayed.deals + (next.deals - decayed.deals) * mealMult),
          };
        }
      }
      // Archetype reducer multipliers (after base reducer math, before clamp).
      const archetypeKey =
        action === "work" ? "work" : action === "play" ? "play" : action === "rest" ? "rest" : null;
      if (archetypeKey) {
        const m = archetype[archetypeKey];
        if (m !== 1) {
          for (const k of ["hunger", "happiness", "energy", "deals"] as const) {
            const baseValue = decayed[k];
            const delta = next[k] - baseValue;
            next = { ...next, [k]: Math.max(0, Math.min(100, baseValue + delta * m)) };
          }
        }
      }
      next = stampAction(next, action, now);
      next = accrueLifetimeDeals(next, action, now);
      next = appendActionHistory(next, action, now);
      next = ensureReviewCounters(next, now);
      const tick = tickDeals(next, action, now);
      next = tick.stats;
      const narration: string[] = [];
      const offerCap = perkPipelineCap(next, 2);
      if (action === "work" && (next.activeDeals?.length ?? 0) < offerCap) {
        const offer = maybeOfferDeal(
          next,
          now,
          dealSchedulerRef.current,
          offerCap,
          guaranteeDailyDeal,
        );
        next = offer.stats;
        if (offer.offered) {
          const msg = `New deal logged: ${formatDeal(offer.offered, now)}.`;
          narration.push(msg);
          appendNotification("deal", msg, now);
        }
      }
      const synergy = detectSynergy(next, now);
      next = synergy.stats;
      if (synergy.matched && synergy.message) {
        const mult = perkSynergyMultiplier(next);
        if (mult > 1 && synergy.matched) {
          // Apply the additional fraction of the bonus deltas (rainmaker perk)
          const bonus = mult - 1;
          for (const [statKey, delta] of Object.entries(synergy.matched.delta)) {
            if (typeof delta !== "number") continue;
            const k = statKey as "hunger" | "happiness" | "energy" | "deals";
            next = { ...next, [k]: Math.max(0, Math.min(100, next[k] + delta * bonus)) };
          }
        }
        narration.push(synergy.message);
        appendNotification("synergy", synergy.message, now);
        next = recordSynergyProgress(next, synergy.matched.id, now);
        next = bumpDailyChallenge(next, "synergy_1", 1, now).stats;
      }
      if (tick.completed.length > 0) {
        next = bumpDealsClosed(next, tick.completed.length);
        next = {
          ...next,
          achievementProgress: {
            ...achievementProgressOf(next, now),
            pipelineCompletions:
              achievementProgressOf(next, now).pipelineCompletions + tick.completed.length,
          },
        };
        next = bumpDailyChallenge(next, "close_deals_2", tick.completed.length, now).stats;
        const agendaBump = bumpAgenda(next, "close_deal", tick.completed.length, now);
        next = agendaBump.stats;
        for (const item of agendaBump.completed) {
          const msg = `Agenda mandate complete: ${item.label}.`;
          narration.push(msg);
          appendNotification("challenge", msg, now);
        }
      }
      for (const d of tick.completed) {
        const msg = `Deal closed: ${d.name}. +${d.reward} lifetime deals.`;
        narration.push(msg);
        appendNotification("deal", msg, now);
      }
      for (const d of tick.expired) {
        const msg = `Deal expired: ${d.name}. Pipeline scrubbed.`;
        narration.push(msg);
        appendNotification("deal", msg, now);
      }

      // Streak + daily challenge ticks.
      const streakBump = bumpStreakForAction(next, now);
      next = streakBump.stats;
      if (streakBump.bumped) {
        const sLine = `Streak now ${next.streak?.count}d (best ${next.streak?.bestCount}d).`;
        appendNotification("streak", sLine, now);
        if (streakBump.reset) narration.push("Streak reset — start anew.");
        if (streakBump.milestone) {
          const milestoneMsg = `Streak milestone reached. +${streakBump.rewardLifetime} lifetime deals.`;
          narration.push(milestoneMsg);
          appendNotification("streak", milestoneMsg, now);
        }
      }
      const challengeBump = bumpDailyChallenge(next, "pet_action", 1, now);
      next = challengeBump.stats;
      if (challengeBump.completedNow) {
        const msg = "Daily challenge complete. +25 deals + 1 charter.";
        narration.push(msg);
        appendNotification("challenge", msg, now);
      }
      const agendaAction = bumpAgendaForAction(next, action, now);
      next = agendaAction.stats;
      for (const item of agendaAction.completed) {
        const msg = `Agenda mandate complete: ${item.label}.`;
        narration.push(msg);
        appendNotification("challenge", msg, now);
      }

      // Boss step triggers.
      if (action === "work" || action === "praise") {
        const bossKind = action === "work" ? "work" : "praise";
        const bossRes = advanceBoss(next, bossKind, now);
        if (bossRes.message) {
          narration.push(bossRes.message);
          appendNotification("boss", bossRes.message, now);
        }
        if (bossRes.completed) {
          unlockBadge("boss_quarterly", narration, now);
        }
        next = bossRes.stats;
        if (bossRes.advanced) {
          const agendaBump = bumpAgenda(next, "boss_step", 1, now);
          next = agendaBump.stats;
          if (bossNeedsAudit(next, now)) scheduleNextEventFrom(now, next);
        }
      }
      next = recordHealthyProgress(next, now);
      evaluateProgressBadges(next, narration, now);

      explicitPetSavePendingRef.current = true;
      petStatsRef.current = { ...next, lastSaved: now };
      setPetStats(() => ({ ...next, lastSaved: now }));
      for (const line of narration) addItem("system", line);

      // Achievement checks (no state mutation needed; achievements are
      // tracked in their own file).
      if (!isAchievementUnlocked("first_blood")) {
        unlockBadge("first_blood", [], now, /*silent*/ false);
      }
      const streakCount = next.streak?.bestCount ?? 0;
      if (streakCount >= 7 && !isAchievementUnlocked("streak_7")) {
        unlockBadge("streak_7", [], now, false);
      }
      const perkCount = next.perks?.length ?? 0;
      if (perkCount >= 3 && !isAchievementUnlocked("perk_collector")) {
        unlockBadge("perk_collector", [], now, false);
      }
    },
    [addItem, evaluateProgressBadges, scheduleNextEventFrom, unlockBadge],
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
      const order = ["intern", "analyst", "associate", "vp", "md"] as const;
      const prevIdx = order.indexOf(previous);
      const nextIdx = order.indexOf(current);
      if (nextIdx > prevIdx) {
        const now = Date.now();
        addItem(
          "system",
          `PROMOTION MEMO: Drexler ranked up to ${rankLabel(current)}. Reward: more meetings.`,
        );
        appendNotification(
          "promotion",
          `Promotion to ${rankLabel(current)}. +${nextIdx - prevIdx} promotion point${
            nextIdx - prevIdx === 1 ? "" : "s"
          }.`,
          now,
        );
        // Grant perk points on every forward step (V52).
        const grant = grantPerkPointOnPromotion(petStatsRef.current, prevIdx, nextIdx);
        if (grant.granted) {
          explicitPetSavePendingRef.current = true;
          const stamped = { ...grant.stats, lastSaved: now };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          addItem("system", `Promotion point earned. /perks to review, /perk <id> to spend.`);
        }
        // First VP promotion unlocks the boss encounter.
        if (current === "vp" && !petStatsRef.current.boss) {
          const bossStart = startBoss(petStatsRef.current, BOSS_QUARTERLY, now);
          if (bossStart.ok) {
            explicitPetSavePendingRef.current = true;
            const stamped = { ...bossStart.stats, lastSaved: now };
            petStatsRef.current = stamped;
            setPetStats(() => stamped);
            addItem("system", bossStart.message);
            appendNotification("boss", bossStart.message, now);
          }
        }
        // First VP promotion also opens archetype choice notification.
        if (current === "vp" && !petStatsRef.current.archetype) {
          addItem(
            "system",
            "Archetype unlocked. Choose with /archetype <closer|networker|operator>.",
          );
        }
        // MD-rank achievement.
        if (current === "md" && !isAchievementUnlocked("intern_to_md")) {
          const ackRes = unlockAchievement("intern_to_md", now);
          if (ackRes.ok) {
            addItem("system", `Badge unlocked: ${ackRes.def.title} — ${ackRes.def.description}`);
            appendNotification("badge", `Badge: ${ackRes.def.title}`, now);
          }
        }
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
  const reportPetSaveFailure = useCallback(
    (message: string) => {
      const now = Date.now();
      if (now - lastPetSaveNoticeAtRef.current < 30_000) return;
      lastPetSaveNoticeAtRef.current = now;
      addItem("system", message);
      setDeskStatus("error");
      setDeskNotice("pet save failed");
    },
    [addItem],
  );
  useEffect(() => {
    if (!petSaveInitRef.current) {
      petSaveInitRef.current = true;
      return;
    }
    const explicit = explicitPetSavePendingRef.current;
    explicitPetSavePendingRef.current = false;
    void savePetState(petStats).then((result) => {
      if (!explicit || result.ok) return;
      const detail =
        result.reason === "locked" ? "another Drexler process is writing" : result.reason;
      reportPetSaveFailure(`Pet persistence warning: ${detail}. This action may not survive exit.`);
    });
  }, [petStats, reportPetSaveFailure]);

  // Real-time stat decay matches the offline per-hour decay rate. V63
  // requires the setState updater to be pure — so we precompute the
  // next state from `petStatsRef.current` and dispatch a fixed value.
  // Narration + badge evaluation fire AFTER dispatch so StrictMode dev
  // double-invokes of any setState reducer cannot double-fire them.
  useEffect(() => {
    petDecayTimerRef.current = setInterval(() => {
      const now = Date.now();
      const stats = petStatsRef.current;
      const mult = composeDecayMultiplier(stats, now);
      const decayed = applyDecay(stats, now, mult);
      const dealTick = tickDeals(decayed, null, now);
      let next = dealTick.stats;
      const { stats: afterWorldRaw, expired } = expireWorldEvent(next, now);
      next = afterWorldRaw;
      let worldMsg: string | null = null;
      if (expired) {
        next = recordWorldSurvived(next, expired.kind, now);
        worldMsg = `${expired.title} window closed. Modifiers reverting.`;
      }
      next = recordHealthyProgress(next, now);
      const noChange =
        next === stats && dealTick.expired.length === 0 && expired === null && worldMsg === null;
      if (noChange) return;
      const stamped = { ...next, lastSaved: now };
      petStatsRef.current = stamped;
      setPetStats(() => stamped);
      for (const d of dealTick.expired) {
        const msg = `Deal expired: ${d.name}. Pipeline scrubbed.`;
        appendNotification("deal", msg, now);
        addItem("system", msg);
      }
      if (worldMsg !== null) {
        appendNotification("world", worldMsg, now);
        addItem("system", worldMsg);
      }
      evaluateProgressBadges(stamped, [], now);
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
  }, [addItem, evaluateProgressBadges]);

  // Event scheduler — schedules a random-gap spawn while pet mode is on
  // and no event is active. Only spawns when the user isn't streaming or
  // inside a synergy animation (V41). Cleared whenever petMode toggles
  // off or an event becomes active.
  useEffect(() => {
    if (eventSpawnTimerRef.current !== null) {
      clearTimeout(eventSpawnTimerRef.current);
      eventSpawnTimerRef.current = null;
    }
    if (!petMode || isDead || activeEvent !== null) return;
    const now = Date.now();
    if (nextEventDueAtRef.current === null) {
      scheduleNextEventFrom(now, petStatsRef.current);
    }
    const dueAt = nextEventDueAtRef.current ?? now + 6 * 60_000;
    const delay = Math.max(0, dueAt - now);
    const handle = setTimeout(() => {
      eventSpawnTimerRef.current = null;
      if (!petModeRef.current) return;
      if (requestInFlightRef.current || synergyActiveRef.current) {
        nextEventDueAtRef.current = Date.now() + 60_000;
        setDeskNotice("event deferred");
        setEventScheduleNonce((n) => n + 1);
        return;
      }
      const spawnAt = Date.now();
      const scheduler = bossNeedsAudit(petStatsRef.current, spawnAt)
        ? {
            ...eventSchedulerRef.current,
            pickEvent: () => EVENT_POOL.find((e) => e.kind === "audit") ?? EVENT_POOL[0]!,
          }
        : eventSchedulerRef.current;
      const event = spawnEvent(spawnAt, scheduler);
      nextEventDueAtRef.current = null;
      activeEventRef.current = event;
      setActiveEvent(event);
      addItem(
        "system",
        [`EVENT: ${event.prompt}`, ...event.choices.map((c) => `  ${c.key}. ${c.label}`)].join(
          "\n",
        ),
      );
    }, delay);
    eventSpawnTimerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (eventSpawnTimerRef.current === handle) eventSpawnTimerRef.current = null;
    };
  }, [petMode, isDead, activeEvent, eventScheduleNonce, addItem, scheduleNextEventFrom]);

  // Event expiration — fires when the 30s window passes without a
  // /respond. Applies the neutral expire outcome per V42.
  useEffect(() => {
    if (eventExpireTimerRef.current !== null) {
      clearTimeout(eventExpireTimerRef.current);
      eventExpireTimerRef.current = null;
    }
    if (!activeEvent) return;
    const ms = Math.max(0, activeEvent.expiresAt - Date.now());
    const handle = setTimeout(() => {
      eventExpireTimerRef.current = null;
      const event = activeEventRef.current;
      if (!event || !isEventExpired(event)) return;
      const { stats: next, message } = applyEventExpire(petStatsRef.current);
      petStatsRef.current = next;
      addItem("system", message);
      activeEventRef.current = null;
      setActiveEvent(null);
      scheduleNextEventFrom(Date.now(), next);
    }, ms);
    eventExpireTimerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (eventExpireTimerRef.current === handle) eventExpireTimerRef.current = null;
    };
  }, [activeEvent, addItem, scheduleNextEventFrom]);

  // Daily review — runs once per local-calendar day on first eligible
  // render after `/pet on` (or boot if already on). Skipped when there's
  // no prior activity in the last 24h (V49). After display the new
  // counters are reset so today's actions count fresh.
  useEffect(() => {
    if (!petMode || isDead) return;
    if (dailyReviewShownThisLaunchRef.current) return;
    const now = Date.now();
    const gate = evaluateReviewGate(petStatsRef.current, now);
    if (!gate.shouldShow) {
      if (gate.reason === "already_shown" || gate.reason === "no_activity") {
        dailyReviewShownThisLaunchRef.current = true;
      }
      return;
    }
    const snap = buildReviewSnapshot({ stats: petStatsRef.current, now });
    addItem("system", formatReview(snap));
    dailyReviewShownThisLaunchRef.current = true;
    const advanced = markReviewShown(petStatsRef.current, now);
    const reset = ensureReviewCounters({ ...advanced, reviewCounters: undefined }, now);
    explicitPetSavePendingRef.current = true;
    petStatsRef.current = { ...reset, lastSaved: now };
    setPetStats(() => ({ ...reset, lastSaved: now }));
  }, [petMode, isDead, addItem]);

  // Death detection
  useEffect(() => {
    if (isDead || !isPetDead(petStats)) return;
    const reason =
      petStats.hunger <= 0 ? "hunger" : petStats.happiness <= 0 ? "happiness" : "energy";
    setDeathReason(reason);
    setDeathVariant(pickInt(defaultRng, 5));
    setIsDead(true);
    // Record this life in the graveyard BEFORE the respawn reset writes
    // over `name` + lifetimeDeals on next load (V47).
    try {
      appendGraveyardEntry(buildGraveyardEntry(petStats, reason));
    } catch {
      // Graveyard write is best-effort; failure must not block death flow.
    }
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

  useEffect(() => {
    if (!registerGracefulExitHandler) return;
    registerGracefulExitHandler(() => triggerExit(SIGINT_MSG));
    return () => {
      registerGracefulExitHandler(null);
    };
  }, [registerGracefulExitHandler, triggerExit]);

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
        streamTimerRef.current = setTimeout(flushStream, 50);
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
    async (instruction?: string, attachments?: readonly Attachment[]) => {
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
          const baseMessages = instruction
            ? [
                ...buildMessagesWithReminder(conversation),
                { role: "system" as const, content: instruction },
              ]
            : buildMessagesWithReminder(conversation);
          const petSummary = petModeRef.current ? buildPetSummary(petStatsRef.current) : null;
          const composedMessages = injectPetSummary(baseMessages, petSummary);
          result = await streamChat({
            apiKey,
            model,
            fallbackModel: pickFallback(model),
            messages: composedMessages,
            attachments,
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
          setThinking(null);
          setStreaming(null);
          if (cancelledRef.current) {
            cancelledRef.current = false;
            addItem("system", "(cancelled response discarded — /retry available)");
            setDeskNotice("response cancelled");
          } else {
            const msg = caughtErr instanceof Error ? caughtErr.message : String(caughtErr);
            addItem("system", `${STREAM_ERROR} [${msg}]`);
            setDeskStatus("error");
            setDeskNotice(msg);
          }
          setMsgCount(conversation.length);
          return;
        }
        setThinking(null);
        setStreaming(null);
        if (cancelledRef.current) {
          cancelledRef.current = false;
          addItem("system", "(cancelled response discarded — /retry available)");
          setDeskNotice("response cancelled");
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
    [apiKey, model, fetchFn, addItem, conversation, pushTokenToStream, persistSession],
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
        // quick_recovery perk shaves cooldown remaining (V52).
        const reduction = perkCooldownReductionMs(petStatsRef.current);
        const remaining = cd.ok ? 0 : Math.max(0, cd.remainingMs - reduction);
        if (!cd.ok && remaining > 0) {
          addItem(
            "system",
            `Drexler ${cooldownAction === "feed" ? "just ate" : cooldownAction === "play" ? "just played" : cooldownAction === "work" ? "just worked" : cooldownAction === "praise" ? "just got praised" : cooldownAction === "rest" ? "just rested" : "just vibed"}. Wait ${formatCooldownRemaining(remaining)} before the next attempt. Drexler resents micromanagement.`,
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
        const now = Date.now();
        const ipoMult = worldWorkDealMultiplier(petStatsRef.current, now);
        const mutator = (s: PetStats): PetStats => {
          const base = applyWork(s);
          if (ipoMult === 1) return base;
          const extra = base.deals - s.deals;
          return { ...base, deals: Math.min(100, s.deals + extra * ipoMult) };
        };
        applyPetAction("work", mutator);
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
        const roll = defaultRng();
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
        explicitPetSavePendingRef.current = true;
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
      if (slashCommand === "/respond") {
        const event = activeEventRef.current;
        if (!event) {
          addItem("system", "Drexler has no pending event to respond to.");
          return;
        }
        const arg = lower.slice("/respond".length).trim();
        const now = Date.now();
        if (arg.length === 0 || !/^[1-3]$/.test(arg)) {
          addItem("system", "Usage: /respond 1|2|3 — pick a choice for the active event.");
          return;
        }
        const result = applyEventChoice(petStatsRef.current, event, arg, now);
        if (!result) {
          addItem("system", "Choice rejected (window closed or unknown option).");
          return;
        }
        let reviewBumped = bumpEventsSurvived(result.stats);
        // Audit survival tracking + audit_survivor_5 badge.
        if (event.kind === "audit") {
          reviewBumped = {
            ...reviewBumped,
            achievementProgress: {
              ...achievementProgressOf(reviewBumped, now),
              auditEventsSurvived: achievementProgressOf(reviewBumped, now).auditEventsSurvived + 1,
            },
          };
          // Boss step trigger.
          const bossRes = advanceBoss(reviewBumped, "audit_response", now);
          reviewBumped = bossRes.stats;
          if (bossRes.message) addItem("system", bossRes.message);
          if (bossRes.advanced) {
            reviewBumped = bumpAgenda(reviewBumped, "boss_step", 1, now).stats;
          }
        }
        // Daily challenge: survive_2_events tally.
        const dcBump = bumpDailyChallenge(reviewBumped, "survive_2_events", 1, now);
        reviewBumped = dcBump.stats;
        if (dcBump.completedNow) {
          addItem("system", "Daily challenge complete. +25 deals + 1 charter.");
        }
        explicitPetSavePendingRef.current = true;
        petStatsRef.current = { ...reviewBumped, lastSaved: now };
        setPetStats(() => ({ ...reviewBumped, lastSaved: now }));
        addItem("system", result.message);
        appendNotification("event", result.message, now);
        evaluateProgressBadges(reviewBumped, [], now);
        if (eventExpireTimerRef.current !== null) {
          clearTimeout(eventExpireTimerRef.current);
          eventExpireTimerRef.current = null;
        }
        activeEventRef.current = null;
        setActiveEvent(null);
        scheduleNextEventFrom(now, reviewBumped);
        return;
      }
      if (slashCommand === "/trade") {
        if (isDead) {
          addItem("system", "Drexler can't trade from HR.");
          return;
        }
        const parts = line.split(/\s+/).slice(1);
        const ticker = parts[0] ? parseTicker(parts[0]) : null;
        const side = parts[1] ? parseSide(parts[1]) : null;
        if (!ticker || !side) {
          addItem("system", "Usage: /trade <AAPL|MSFT|NVDA> <buy|sell>");
          return;
        }
        const now = Date.now();
        const outcome = attemptTrade(petStatsRef.current, ticker as Ticker, side, {
          now,
          chartered: perkChartered(petStatsRef.current),
          tradeEye: perkTradeEye(petStatsRef.current),
        });
        if (!outcome.ok) {
          addItem("system", outcome.message);
          return;
        }
        let stats = outcome.stats;
        // Market crash world event amplifies losses ×2 (apply remainder once,
        // since attemptTrade already applied base loss deltas).
        if (outcome.result === "loss") {
          const crashMult = worldTradeLossMultiplier(stats, now);
          if (crashMult > 1) {
            const extra = crashMult - 1;
            stats = {
              ...stats,
              deals: Math.max(0, stats.deals + -15 * extra),
              happiness: Math.max(0, stats.happiness + -5 * extra),
            };
          }
        }
        explicitPetSavePendingRef.current = true;
        const stamped = { ...stats, lastSaved: now };
        petStatsRef.current = stamped;
        setPetStats(() => stamped);
        addItem("system", outcome.message);
        appendNotification("event", outcome.message, now);
        if (outcome.result === "win") {
          stats = {
            ...petStatsRef.current,
            achievementProgress: {
              ...achievementProgressOf(petStatsRef.current, now),
              tradeWins: achievementProgressOf(petStatsRef.current, now).tradeWins + 1,
            },
          };
          petStatsRef.current = { ...stats, lastSaved: now };
          setPetStats(() => ({ ...stats, lastSaved: now }));
          const bumped = bumpDailyChallenge(petStatsRef.current, "win_trade", 1, now);
          if (bumped.completedNow) {
            petStatsRef.current = { ...bumped.stats, lastSaved: now };
            setPetStats(() => ({ ...bumped.stats, lastSaved: now }));
            addItem("system", "Daily challenge complete. +25 deals + 1 charter.");
          } else if (bumped.stats !== petStatsRef.current) {
            petStatsRef.current = { ...bumped.stats, lastSaved: now };
            setPetStats(() => ({ ...bumped.stats, lastSaved: now }));
          }
          evaluateProgressBadges(petStatsRef.current, [], now);
          const agendaTrade = bumpAgenda(petStatsRef.current, "win_trade", 1, now);
          if (agendaTrade.completed.length > 0) {
            addItem("system", `Agenda mandate complete: ${agendaTrade.completed[0]!.label}.`);
          }
          if (agendaTrade.stats !== petStatsRef.current) {
            petStatsRef.current = { ...agendaTrade.stats, lastSaved: now };
            setPetStats(() => ({ ...agendaTrade.stats, lastSaved: now }));
          }
          // Boss step trigger.
          const bossRes = advanceBoss(petStatsRef.current, "trade_win", now);
          if (bossRes.message) addItem("system", bossRes.message);
          if (bossRes.stats !== petStatsRef.current) {
            const bossed = { ...bossRes.stats, lastSaved: now };
            petStatsRef.current = bossed;
            setPetStats(() => bossed);
            if (bossRes.advanced && bossNeedsAudit(bossed, now)) scheduleNextEventFrom(now, bossed);
          }
        }
        return;
      }
      if (slashCommand === "/buy") {
        const arg = lower.slice("/buy".length).trim();
        const item = parseInventoryItem(arg);
        if (!item) {
          addItem("system", "Usage: /buy <coffee|pastry|charter>");
          return;
        }
        const r = buyItem(petStatsRef.current, item);
        addItem("system", r.message);
        if (r.ok) {
          explicitPetSavePendingRef.current = true;
          const stamped = { ...r.stats, lastSaved: Date.now() };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
        }
        return;
      }
      if (slashCommand === "/use") {
        const arg = lower.slice("/use".length).trim();
        const item = parseInventoryItem(arg);
        if (!item) {
          addItem("system", "Usage: /use <coffee|pastry|charter>");
          return;
        }
        const now = Date.now();
        const r = consumeInventoryItem(petStatsRef.current, item, now);
        addItem("system", r.message);
        if (r.ok) {
          let next: PetStats = r.stats;
          const clear = r.sideEffects?.clearCooldown;
          if (clear && next.lastActionAt) {
            const stripped = { ...next.lastActionAt };
            delete stripped[clear];
            next = {
              ...next,
              lastActionAt: Object.keys(stripped).length > 0 ? stripped : undefined,
            };
          }
          explicitPetSavePendingRef.current = true;
          const stamped = { ...next, lastSaved: now };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          if (item === "charter") {
            const progress = achievementProgressOf(stamped, now);
            const withProgress: PetStats = {
              ...stamped,
              achievementProgress: { ...progress, chartersUsed: progress.chartersUsed + 1 },
            };
            petStatsRef.current = withProgress;
            setPetStats(() => withProgress);
            evaluateProgressBadges(withProgress, [], now);
          }
        }
        return;
      }
      // View-only handlers (V67) — single dispatch via the extracted
      // module. Stateful pet handlers (/perk, /trade, /buy, /use,
      // /respond, /pitch, /negotiate, /archetype) stay inline because
      // they mutate state via setPetStats + side-effect timers.
      if (
        handlePetViewSlash(slashCommand, {
          stats: petStatsRef.current,
          now: Date.now(),
          addItem,
        })
      ) {
        return;
      }
      if (slashCommand === "/perk") {
        const arg = lower.slice("/perk".length).trim();
        const perkId = parsePerkId(arg);
        if (!perkId) {
          addItem(
            "system",
            "Usage: /perk <slow_decay|quick_recovery|big_meals|trade_eye|pipeline|chartered|iron_liver|rainmaker>",
          );
          return;
        }
        const r = spendPerkPoint(petStatsRef.current, perkId);
        addItem("system", r.ok ? `Perk acquired: ${r.def.title}.` : r.message);
        if (r.ok) {
          explicitPetSavePendingRef.current = true;
          const stamped = { ...r.stats, lastSaved: Date.now() };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          appendNotification("perk", `Perk: ${r.def.title}`, Date.now());
        }
        return;
      }
      if (slashCommand === "/archetype") {
        const arg = lower.slice("/archetype".length).trim();
        if (arg.length === 0) {
          addItem("system", renderArchetypes(petStatsRef.current));
          return;
        }
        const order = ["intern", "analyst", "associate", "vp", "md"] as const;
        const rankIdx = order.indexOf(getPetRank(petStatsRef.current));
        const r = chooseArchetype(petStatsRef.current, arg, rankIdx);
        addItem(
          "system",
          r.ok ? `Archetype locked: ${r.def.id} — ${r.def.description}` : r.message,
        );
        if (r.ok) {
          explicitPetSavePendingRef.current = true;
          const stamped = { ...r.stats, lastSaved: Date.now() };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          const badgeId =
            r.def.id === "closer"
              ? "closer_chosen"
              : r.def.id === "networker"
                ? "networker_chosen"
                : "operator_chosen";
          if (!isAchievementUnlocked(badgeId)) {
            const a = unlockAchievement(badgeId, Date.now());
            if (a.ok) addItem("system", `Badge unlocked: ${a.def.title}.`);
          }
          appendNotification("archetype", `Archetype: ${r.def.id}`, Date.now());
        }
        return;
      }
      if (slashCommand === "/pitch") {
        if (pitchActive || activeNegotiateRef.current) {
          addItem("system", "Drexler already in a mini-game.");
          return;
        }
        const ok = canStartPitch(petStatsRef.current);
        if (!ok.ok) {
          addItem("system", ok.message);
          return;
        }
        const now = Date.now();
        pitchStartedAtRef.current = now;
        setPitchActive(true);
        setPitchFrame(0);
        addItem("system", "PITCH — bar cycling. Press Enter to hit at the peak ▇█.");
        if (pitchTimerRef.current !== null) clearInterval(pitchTimerRef.current);
        pitchTimerRef.current = setInterval(() => {
          setPitchFrame((f) => f + 1);
        }, 200);
        return;
      }
      if (slashCommand === "/negotiate") {
        if (activeNegotiateRef.current || pitchActive) {
          addItem("system", "Drexler already in a mini-game.");
          return;
        }
        const r = openNegotiate(petStatsRef.current);
        if (!r.ok) {
          addItem("system", r.message);
          return;
        }
        const startedAt = Date.now();
        const state = { scenario: r.scenario!, startedAt };
        activeNegotiateRef.current = state;
        setActiveNegotiate(state);
        if (negotiateExpireTimerRef.current !== null) clearTimeout(negotiateExpireTimerRef.current);
        negotiateExpireTimerRef.current = setTimeout(() => {
          negotiateExpireTimerRef.current = null;
          if (activeNegotiateRef.current?.startedAt !== startedAt) return;
          activeNegotiateRef.current = null;
          setActiveNegotiate(null);
          const msg = "Negotiation window expired. Drexler tables the matter.";
          appendNotification("minigame", msg, Date.now());
          addItem("system", msg);
        }, 30_000);
        const lines = [
          `NEGOTIATE: ${r.scenario!.prompt}`,
          ...r.scenario!.choices.map((c) => {
            const gate =
              c.tone === "bold" && petStatsRef.current.happiness < 60
                ? " (locked: happy<60)"
                : c.tone === "aggressive" && petStatsRef.current.energy < 60
                  ? " (locked: energy<60)"
                  : "";
            return `  ${c.key}. ${c.label}${gate}`;
          }),
          "Pick 1/2/3 (or ESC to abandon).",
        ];
        addItem("system", lines.join("\n"));
        return;
      }

      if (slashCommand === "/attach") {
        const arg = line.slice("/attach".length).trim();
        if (arg.length === 0) {
          addItem("system", "Usage: /attach <path>  ·  /attach remove <n>");
          return;
        }
        // §V75 — remove sub-command. `/attach remove <n>` (1-based).
        const removeMatch = arg.match(/^remove\s+(\d+)\s*$/i);
        if (removeMatch) {
          const n = Number.parseInt(removeMatch[1]!, 10);
          const current = pendingAttachmentsRef.current;
          if (current.length === 0) {
            addItem("system", "No attachments to remove.");
            return;
          }
          if (!Number.isFinite(n) || n < 1 || n > current.length) {
            addItem("system", `No attachment at index ${n}. ${current.length} pending.`);
            return;
          }
          const removed = current[n - 1]!;
          setAttachments(current.filter((_, i) => i !== n - 1));
          addItem(
            "system",
            `Removed ${removed.filename} (${formatBytesShort(removed.sizeBytes)}).`,
          );
          return;
        }
        const path = unquoteDroppedPath(arg);
        const r = await loadAttachment(path);
        if (!r.ok) {
          addItem("system", `Attach rejected: ${r.error.message}`);
          return;
        }
        const placed = tryAttach(r.value);
        if (!placed.ok) {
          addItem("system", placed.reason);
          return;
        }
        pushRecent(path);
        addItem(
          "system",
          `Attached ${r.value.filename} (${formatBytesShort(r.value.sizeBytes)}) ${attShortSha(r.value)}. ESC to clear.`,
        );
        return;
      }
      if (slashCommand === "/paste") {
        pasteArmedRef.current = true;
        addItem("system", "Paste armed. Next paste will be attached.");
        return;
      }
      if (slashCommand === "/attachments") {
        const current = pendingAttachmentsRef.current;
        if (current.length === 0) {
          addItem("system", "No attachments pending.");
          return;
        }
        const lines = ["Pending attachments:"];
        for (const a of current) {
          lines.push(
            `  ${a.kind === "image" ? "image" : "text "} ${a.filename} (${formatBytesShort(a.sizeBytes)}) ${attShortSha(a)}`,
          );
        }
        lines.push("ESC to clear.");
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
        clearAttachments();
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
      clearAttachments,
      config,
      conversation,
      evaluateProgressBadges,
      formatBytesShort,
      isDead,
      model,
      PET_MESSAGES,
      pitchActive,
      removeLastAssistantItem,
      runLLM,
      runSynergyEvent,
      setAttachments,
      setDashboardPetMode,
      scheduleNextEventFrom,
      triggerExit,
      triggerPetActivity,
      tryAttach,
      updateDraft,
      updatePetStats,
    ],
  );

  const onSubmit = useCallback(
    async (raw: string) => {
      if (requestInFlightRef.current || synergyActiveRef.current) return;
      const line = raw.trim();
      const attachments = pendingAttachmentsRef.current;
      if (line === "" && attachments.length === 0) {
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
      // §V76 — multi-file drop: N≥2 newline-separated absolute paths.
      // Each path is loaded independently; success accrues to chip strip,
      // failures emit one notice each. Payload is never sent as text.
      if (attachments.length === 0) {
        const paths = parseMultiFileDrop(raw);
        if (paths !== null) {
          let added = 0;
          for (const p of paths) {
            const r = await loadAttachment(p);
            if (!r.ok) {
              addItem("system", `Attach rejected: ${r.error.message} (${p})`);
              continue;
            }
            const placed = tryAttach(r.value);
            if (!placed.ok) {
              addItem("system", placed.reason);
              break;
            }
            pushRecent(p);
            added += 1;
          }
          if (added > 0) {
            addItem(
              "system",
              `Attached ${added} file${added === 1 ? "" : "s"}. Type a message and Enter, or ESC to clear.`,
            );
          }
          return;
        }
      }
      // Drag/drop: bare absolute-path input auto-attaches when no chips pending.
      if (attachments.length === 0 && isLikelyDroppedPath(line)) {
        const candidate = unquoteDroppedPath(line);
        const r = await loadAttachment(candidate);
        if (r.ok) {
          const placed = tryAttach(r.value);
          if (placed.ok) {
            pushRecent(candidate);
            addItem(
              "system",
              `Attached ${r.value.filename} (${formatBytesShort(r.value.sizeBytes)}) ${attShortSha(r.value)}. Type a message and Enter, or ESC to clear.`,
            );
            return;
          }
          addItem("system", placed.reason);
          return;
        }
        // Loader rejected: fall through and send the path as plain text.
      }
      // Build outbound user message: line + text-attachment fences + image placeholders.
      const textBlocks: string[] = [];
      const imagePlaceholders: string[] = [];
      for (const a of attachments) {
        if (a.kind === "text") {
          textBlocks.push(buildTextAttachmentBlock(a));
        } else {
          imagePlaceholders.push(
            `[attachment: ${a.filename} (${formatBytesShort(a.sizeBytes)}) sha256:${attShortSha(a)}]`,
          );
        }
      }
      const synthesized = [line, ...imagePlaceholders, ...textBlocks]
        .filter((s) => s.length > 0)
        .join("\n\n");
      addItem("user", synthesized);
      conversation.push("user", synthesized);
      setMsgCount(conversation.length);
      const attachmentsForSend = attachments.length > 0 ? [...attachments] : undefined;
      clearAttachments();
      await runLLM(undefined, attachmentsForSend);
    },
    [
      addItem,
      clearAttachments,
      conversation,
      formatBytesShort,
      handleSlashWithMutation,
      runLLM,
      setPaletteIdx,
      tryAttach,
      updateDraft,
    ],
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
    // Pitch mini-game: Enter resolves, ESC aborts (V57).
    if (pitchActive) {
      if (key.return) {
        const startedAt = pitchStartedAtRef.current ?? Date.now();
        const now = Date.now();
        const r = resolvePitch(petStatsRef.current, startedAt, now);
        explicitPetSavePendingRef.current = true;
        let resolvedStats = r.stats;
        if (r.hit) {
          const progress = achievementProgressOf(resolvedStats, now);
          resolvedStats = {
            ...resolvedStats,
            achievementProgress: { ...progress, pitchHits: progress.pitchHits + 1 },
          };
        }
        const stamped = { ...resolvedStats, lastSaved: now };
        petStatsRef.current = stamped;
        setPetStats(() => stamped);
        addItem("system", r.message);
        appendNotification("minigame", r.message, now);
        if (r.hit) {
          evaluateProgressBadges(resolvedStats, [], now);
        }
        if (pitchTimerRef.current !== null) {
          clearInterval(pitchTimerRef.current);
          pitchTimerRef.current = null;
        }
        setPitchActive(false);
        pitchStartedAtRef.current = null;
        return;
      }
      if (key.escape) {
        if (pitchTimerRef.current !== null) {
          clearInterval(pitchTimerRef.current);
          pitchTimerRef.current = null;
        }
        setPitchActive(false);
        pitchStartedAtRef.current = null;
        addItem("system", "Pitch aborted.");
        return;
      }
      return;
    }
    // Negotiate mini-game: 1/2/3 picks, ESC aborts (V57).
    if (activeNegotiateRef.current) {
      const negotiateState = activeNegotiateRef.current;
      const scenario = negotiateState.scenario;
      if (key.escape) {
        if (negotiateExpireTimerRef.current !== null) {
          clearTimeout(negotiateExpireTimerRef.current);
          negotiateExpireTimerRef.current = null;
        }
        activeNegotiateRef.current = null;
        setActiveNegotiate(null);
        addItem("system", "Negotiation abandoned.");
        return;
      }
      if (!key.ctrl && !key.meta && (char === "1" || char === "2" || char === "3")) {
        const now = Date.now();
        if (now - negotiateState.startedAt > 30_000) {
          if (negotiateExpireTimerRef.current !== null) {
            clearTimeout(negotiateExpireTimerRef.current);
            negotiateExpireTimerRef.current = null;
          }
          activeNegotiateRef.current = null;
          setActiveNegotiate(null);
          addItem("system", "Negotiation window expired. Choice ignored.");
          return;
        }
        const r = resolveNegotiate(petStatsRef.current, scenario, char, now);
        if (r) {
          explicitPetSavePendingRef.current = true;
          let resolvedStats = r.stats;
          if (r.stats.minigame?.lastNegotiateAt === now) {
            const progress = achievementProgressOf(resolvedStats, now);
            resolvedStats = {
              ...resolvedStats,
              achievementProgress: {
                ...progress,
                negotiateWins: progress.negotiateWins + 1,
              },
            };
          }
          const stamped = { ...resolvedStats, lastSaved: now };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          addItem("system", r.message);
          appendNotification("minigame", r.message, now);
          if (resolvedStats.minigame?.lastNegotiateAt === now) {
            // counted as a successful resolution
            evaluateProgressBadges(resolvedStats, [], now);
            if (negotiateExpireTimerRef.current !== null) {
              clearTimeout(negotiateExpireTimerRef.current);
              negotiateExpireTimerRef.current = null;
            }
            activeNegotiateRef.current = null;
            setActiveNegotiate(null);
          }
        }
        return;
      }
      return;
    }
    // Active event ESC cancels with a small happiness hit (V42). The
    // hotkeys 1/2/3 mirror `/respond` so the user can answer without
    // typing the slash.
    if (activeEventRef.current && !synergyActiveRef.current && synergyEvent === null) {
      if (key.escape) {
        const event = activeEventRef.current;
        const now = Date.now();
        const { stats: next, message } = applyEventCancel(petStatsRef.current);
        explicitPetSavePendingRef.current = true;
        const stamped = { ...next, lastSaved: now };
        petStatsRef.current = stamped;
        setPetStats(() => stamped);
        addItem("system", message);
        if (eventExpireTimerRef.current !== null) {
          clearTimeout(eventExpireTimerRef.current);
          eventExpireTimerRef.current = null;
        }
        activeEventRef.current = null;
        setActiveEvent(null);
        scheduleNextEventFrom(now, next);
        void event;
        return;
      }
      if (!key.ctrl && !key.meta && (char === "1" || char === "2" || char === "3")) {
        const event = activeEventRef.current;
        const now = Date.now();
        const result = applyEventChoice(petStatsRef.current, event, char, now);
        if (result) {
          let reviewBumped = bumpEventsSurvived(result.stats);
          if (event.kind === "audit") {
            reviewBumped = {
              ...reviewBumped,
              achievementProgress: {
                ...achievementProgressOf(reviewBumped, now),
                auditEventsSurvived:
                  achievementProgressOf(reviewBumped, now).auditEventsSurvived + 1,
              },
            };
            const bossRes = advanceBoss(reviewBumped, "audit_response", now);
            reviewBumped = bossRes.stats;
            if (bossRes.message) addItem("system", bossRes.message);
            if (bossRes.advanced) {
              reviewBumped = bumpAgenda(reviewBumped, "boss_step", 1, now).stats;
            }
          }
          const dcBump = bumpDailyChallenge(reviewBumped, "survive_2_events", 1, now);
          reviewBumped = dcBump.stats;
          if (dcBump.completedNow) {
            addItem("system", "Daily challenge complete. +25 deals + 1 charter.");
          }
          explicitPetSavePendingRef.current = true;
          const stamped = { ...reviewBumped, lastSaved: now };
          petStatsRef.current = stamped;
          setPetStats(() => stamped);
          addItem("system", result.message);
          appendNotification("event", result.message, now);
          evaluateProgressBadges(reviewBumped, [], now);
          if (eventExpireTimerRef.current !== null) {
            clearTimeout(eventExpireTimerRef.current);
            eventExpireTimerRef.current = null;
          }
          activeEventRef.current = null;
          setActiveEvent(null);
          scheduleNextEventFrom(now, reviewBumped);
        }
        return;
      }
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
    // §V70/V73 — ESC over the input clears pending attachments first
    // (chip strip), before the palette/draft escape paths. Only when
    // no palette is open and no other modal owns ESC.
    if (key.escape && !paletteOpen && pendingAttachmentsRef.current.length > 0) {
      clearAttachments();
      pasteArmedRef.current = false;
      addItem("system", "Attachments cleared.");
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
      const { chunks } = splitBracketedPaste(char);
      const armed = pasteArmedRef.current;
      // If no bracketed-paste markers were found AND the whole chunk
      // looks paste-shaped (big or NUL-bearing or /paste-armed), treat
      // the entire char as one paste payload.
      const noMarkers = chunks.length === 1 && chunks[0]!.kind === "text";
      const wholeReasons = classifyPaste(char);
      const treatWholeAsPaste = noMarkers && (armed || wholeReasons.length > 0);
      const effectiveChunks = treatWholeAsPaste
        ? [{ kind: "paste" as const, data: char, reasons: wholeReasons }]
        : chunks;

      for (const ch of effectiveChunks) {
        if (ch.kind === "paste") {
          const shouldAttach = armed || ch.reasons.length > 0;
          if (shouldAttach) {
            const buf = Buffer.from(ch.data, "utf-8");
            const filename = `paste-${Date.now()}.txt`;
            const r = loadAttachmentFromBuffer(buf, filename, "text/plain");
            if (!r.ok) {
              addItem("system", `Paste rejected: ${r.error.message}`);
            } else {
              const placed = tryAttach(r.value);
              if (placed.ok) {
                addItem(
                  "system",
                  `Pasted ${formatBytesShort(r.value.sizeBytes)} attached as ${r.value.filename} ${attShortSha(r.value)}. ESC to clear.`,
                );
              } else {
                addItem("system", placed.reason);
              }
            }
            if (armed) pasteArmedRef.current = false;
            continue;
          }
        }
        // Either a small inline-friendly paste chunk or normal text.
        const normalized = ch.data.replace(/\r\n?/g, "\n");
        // intentional: strip ANSI/control chars
        // eslint-disable-next-line no-control-regex
        const filtered = normalized.replace(/[\x00-\x09\x0b-\x1f]/g, "");
        if (filtered.length > 0) {
          updateDraft((prev) =>
            insertAtCursor(prev.value, clampCursor(prev.value, prev.cursor), filtered),
          );
        }
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
      if (negotiateExpireTimerRef.current !== null) {
        clearTimeout(negotiateExpireTimerRef.current);
        negotiateExpireTimerRef.current = null;
      }
      clearNotifications();
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
  const dealDeskHeader = useMemo(
    () => renderDealDeskHeader(chromeWidth),
    [chromeWidth, renderDealDeskHeader],
  );
  const dealDeskForDashboard = useCallback(
    (width: number) => renderDealDeskHeader(width, 0),
    [renderDealDeskHeader],
  );
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
        {introActive ? <IntroChrome /> : null}
        <ChromePane
          showFullDashboard={showFullDashboard}
          showFallbackPetPanel={showFallbackPetPanel}
          greeting={greeting}
          chromeWidth={chromeWidth}
          mood={mood}
          petMode={petMode}
          introActive={introActive}
          petStats={petStats}
          petActivity={petActivity}
          petEnv={petEnv}
          isBusy={isBusy}
          introProgress={intro.progress}
          introState={intro.state}
          introBar={intro.bar}
          introBarColor={introBarColor}
          introStatus={intro.status}
          dealDeskHeader={dealDeskHeader}
          dealDesk={dealDeskForDashboard}
        />
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
                  {pitchActive && (
                    <Box marginBottom={1} paddingX={2}>
                      <Text color={t.primaryLight}>
                        {`PITCH ${(() => {
                          const f = pitchFrame % 8;
                          const cells = "▁▂▃▄▅▆▇█";
                          let bar = "";
                          for (let i = 0; i < 8; i++) bar += cells[i === f ? f : 0]!;
                          return bar;
                        })()}  Enter at the peak ▇█  ·  ESC to abort`}
                      </Text>
                    </Box>
                  )}
                  {activeNegotiate !== null && (
                    <Box marginBottom={1} paddingX={2} flexDirection="column">
                      <Text
                        color={t.primaryLight}
                        bold
                      >{`NEGOTIATE: ${activeNegotiate.scenario.prompt}`}</Text>
                      {activeNegotiate.scenario.choices.map((c) => (
                        <Text key={c.key}>{`  ${c.key}. ${c.label}`}</Text>
                      ))}
                      <Text>{"  Pick 1/2/3  ·  ESC to abandon"}</Text>
                    </Box>
                  )}
                  <Box flexDirection="column">
                    <InputBox
                      value={input}
                      cursor={cursor}
                      disabled={isBusy || pitchActive || activeNegotiate !== null}
                      disabledLabel={
                        synergyEvent !== null
                          ? "(Synergy event running... boardroom locked)"
                          : pitchActive
                            ? "(Pitch active — Enter at peak, ESC to abort)"
                            : activeNegotiate !== null
                              ? "(Negotiate active — pick 1/2/3, ESC to abandon)"
                              : undefined
                      }
                      width={contentInputWidth}
                      attachments={pendingAttachments.map<AttachmentChip>((a) => ({
                        filename: a.filename,
                        sizeBytes: a.sizeBytes,
                        kind: a.kind,
                        shortSha: attShortSha(a),
                      }))}
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
