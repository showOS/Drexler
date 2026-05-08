import * as readline from "node:readline";
import { dispatch, isSlash, type CommandAction } from "./commands.ts";
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
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "./types.ts";

const EMPTY_NUDGE = "Drexler's time is money. YOUR money. Speak up.";
const STREAM_ERROR =
  "Trading tantrum! Drexler's stream interrupted. Try again.";
const SIGINT_MSG = "Drexler do exit interview. Meeting adjourned.";
const REMINDER_INTERVAL = 5;
const DRIFT_REMINDER =
  "Reminder: stay in character. ≤4 sentences. Never use 'I'. ≤1 catchphrase. Land the joke last.";

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

export interface ReplDeps {
  conversation: Conversation;
  config: Config;
  fetchFn?: FetchFn;
  print: (s: string) => void;
}

function pickFallback(currentModel: string): string {
  return currentModel === MODEL_PRIMARY ? MODEL_FALLBACK : MODEL_PRIMARY;
}

function buildMessagesWithReminder(conv: Conversation): Message[] {
  const snap = conv.snapshot();
  const turns = conv.userTurns;
  if (turns > 0 && turns % REMINDER_INTERVAL === 0) {
    return [...snap, { role: "system", content: DRIFT_REMINDER }];
  }
  return snap;
}

export function detectPersonaDrift(content: string): boolean {
  const noCode = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");
  return /\bI\b|\bI'm\b|\bI'll\b|\bI've\b|\bI'd\b/.test(noCode);
}

async function streamFromHistory(deps: ReplDeps): Promise<void> {
  const spinner = startSpinner();
  let firstToken = true;
  const accent = createAccentBarWriter();

  const onToken = (t: string) => {
    if (firstToken) {
      spinner.stop();
      firstToken = false;
    }
    accent.write(t);
  };

  const result = await streamChat({
    apiKey: deps.config.apiKey,
    model: deps.config.model,
    fallbackModel: pickFallback(deps.config.model),
    messages: buildMessagesWithReminder(deps.conversation),
    onToken,
    fetchFn: deps.fetchFn,
  });

  if (firstToken) spinner.stop();
  accent.end();

  if (result.ok && result.content !== null) {
    deps.conversation.push("assistant", result.content);
    if (result.fellBack) {
      deps.print(info(`(fell back to ${result.modelUsed})`));
    }
    if (detectPersonaDrift(result.content)) {
      deps.print(dim("(persona drift detected — model used 'I')"));
    }
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
    if (action.type === "regenerate") {
      await streamFromHistory(deps);
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
      ? statusLine(deps.config.model, deps.conversation.length, mode)
      : statusLine(deps.config.model, deps.conversation.length),
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
