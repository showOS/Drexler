import * as readline from "node:readline";
import {
  COMMAND_PALETTE,
  dispatch,
  isSlash,
  type CommandAction,
} from "./commands.ts";
import { saveConfig } from "./config.ts";
import type { Conversation } from "./conversation.ts";
import { streamChat, type FetchFn } from "./llm.ts";
import type { Message } from "./types.ts";
import {
  createAccentBarWriter,
  dim,
  error,
  info,
  inputBoxBottom,
  inputBoxHint,
  inputBoxTop,
  pickLayout,
  prompt as styledPrompt,
  startSpinner,
  statusLine,
  termCols,
} from "./renderer.ts";
import {
  DRIFT_REMINDER,
  EMPTY_NUDGE,
  REMINDER_INTERVAL,
  SIGINT_MSG,
  STREAM_ERROR,
} from "./sayings.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "./types.ts";

const SLASH_COMMANDS = COMMAND_PALETTE.map((c) => c.name);

export interface ReplDeps {
  conversation: Conversation;
  config: Config;
  fetchFn?: FetchFn;
  print: (s: string) => void;
}

async function persistPreferences(
  partial: Partial<Config> | undefined,
  print: (s: string) => void,
): Promise<void> {
  if (!partial) return;
  try {
    await saveConfig(partial);
    print(info("Drexler preferences filed."));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    print(error(`Could not save preferences: ${msg}`));
  }
}

export function pickFallback(currentModel: string): string {
  return currentModel === MODEL_PRIMARY ? MODEL_FALLBACK : MODEL_PRIMARY;
}

export function buildMessagesWithReminder(conv: Conversation): Message[] {
  const snap = conv.snapshot();
  const turns = conv.userTurns;
  if (turns > 0 && turns % REMINDER_INTERVAL === 0) {
    return [...snap, { role: "system", content: DRIFT_REMINDER }];
  }
  return snap;
}

// Confusable letters that look like Latin "I" — fold to ASCII before regex
// so detection isn't bypassed by Cyrillic І, Turkish İ, fullwidth Ｉ,
// Greek Iota Ι/ι, script ℐ, Roman numeral Ⅰ.
const I_CONFUSABLES_RE = /[ІіİıＩℐⅠΙι]/g;

export function detectPersonaDrift(content: string): boolean {
  const noCode = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    // Strip LaTeX-style inline math $...$ and display math $$...$$ so
    // `$I = mc^2$` doesn't trip drift detection.
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^\$\n]*\$/g, "");
  const folded = noCode.normalize("NFKC").replace(I_CONFUSABLES_RE, "I");
  return /\bI\b|\bI'm\b|\bI'll\b|\bI've\b|\bI'd\b/.test(folded);
}

interface KeypressKey {
  name?: string;
}
type KeypressListener = (str: string | undefined, key: KeypressKey) => void;

async function streamFromHistory(
  deps: ReplDeps,
  instruction?: string,
): Promise<void> {
  const spinner = startSpinner();
  let firstToken = true;
  const accent = createAccentBarWriter();
  const abort = new AbortController();
  let cancelled = false;

  let escListener: KeypressListener | null = null;
  if (process.stdin.isTTY) {
    escListener = (_str, key) => {
      if (key?.name === "escape") {
        cancelled = true;
        abort.abort();
      }
    };
    process.stdin.on("keypress", escListener);
  }

  const onToken = (t: string) => {
    if (firstToken) {
      spinner.stop();
      firstToken = false;
    }
    accent.write(t);
  };

  let result;
  try {
    result = await streamChat({
      apiKey: deps.config.apiKey,
      model: deps.config.model,
      fallbackModel: pickFallback(deps.config.model),
      messages: instruction
        ? [
            ...buildMessagesWithReminder(deps.conversation),
            { role: "system", content: instruction },
          ]
        : buildMessagesWithReminder(deps.conversation),
      onToken,
      signal: abort.signal,
      fetchFn: deps.fetchFn,
    });
  } finally {
    if (escListener) process.stdin.off("keypress", escListener);
  }

  if (firstToken) spinner.stop();
  accent.end();

  if (result.content) {
    deps.conversation.push("assistant", result.content);
  }
  if (result.ok) {
    if (result.fellBack) {
      deps.print(info(`(fell back to ${result.modelUsed})`));
    }
    if (detectPersonaDrift(result.content)) {
      deps.print(dim("(persona drift detected — model used 'I')"));
    }
  } else if (cancelled) {
    deps.print(dim("(cancelled — Drexler taking lunch)"));
  } else if (result.interrupted) {
    deps.print(dim("(stream interrupted — partial response saved)"));
  } else {
    const detail = result.error ? ` [${result.error}]` : "";
    deps.print(error(`${STREAM_ERROR}${detail}`));
  }
}

export async function handleLine(
  raw: string,
  deps: ReplDeps,
): Promise<CommandAction> {
  const line = raw.trim();

  if (line === "") {
    deps.print(EMPTY_NUDGE);
    return { type: "continue" };
  }

  if (isSlash(line)) {
    const action = dispatch(line, {
      conversation: deps.conversation,
      config: deps.config,
      print: deps.print,
    });
    if (action.type === "continue") {
      await persistPreferences(action.persistConfig, deps.print);
    }
    if (action.type === "regenerate") {
      await streamFromHistory(deps, action.instruction);
      return { type: "continue" };
    }
    return action;
  }

  deps.conversation.push("user", line);
  await streamFromHistory(deps);
  return { type: "continue" };
}

function slashCompleter(line: string): [string[], string] {
  if (!line.startsWith("/")) return [[], line];
  const hits = SLASH_COMMANDS.filter((c) => c.startsWith(line));
  return [hits.length ? hits : SLASH_COMMANDS, line];
}

function printPromptHeader(deps: ReplDeps): void {
  const cols = termCols();
  const mode = pickLayout(cols);
  console.log("");
  console.log(
    mode === "very-narrow"
      ? statusLine(deps.conversation.length, mode)
      : statusLine(deps.conversation.length),
  );
  console.log(inputBoxTop(cols));
}

function printPromptFooter(): void {
  const cols = termCols();
  console.log(inputBoxBottom(cols));
  console.log(inputBoxHint());
  console.log("");
}

export async function startRepl(deps: ReplDeps): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: styledPrompt(),
    completer: slashCompleter,
  });

  let exiting = false;
  const cleanExit = (msg?: string): never => {
    exiting = true;
    if (msg) console.log("\n" + msg);
    try {
      rl.close();
    } catch {}
    process.exit(0);
  };

  rl.on("SIGINT", () => cleanExit(SIGINT_MSG));

  printPromptHeader(deps);
  rl.prompt();
  for await (const line of rl) {
    printPromptFooter();
    const action = await handleLine(line, deps);
    if (action.type === "exit") {
      cleanExit(action.message ?? SIGINT_MSG);
    }
    if (!exiting) {
      printPromptHeader(deps);
      rl.prompt();
    }
  }
}
