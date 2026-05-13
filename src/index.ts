#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render } from "ink";
import { ensureApiKey, LaunchConfigError, resolveConfig, validateLaunchConfig } from "./config.ts";
import { Conversation } from "./conversation.ts";
import { moodLine, pickMood } from "./mood.ts";
import { loadPersonaLazy, pickGreeting } from "./persona.ts";
import {
  banner,
  error,
  infoLine,
  resetMarkedTheme,
  tagline,
  termCols,
  typewriterBanner,
  welcomeBox,
} from "./renderer.ts";
import { flushPetSaves } from "./pet/petState.ts";
import { startRepl } from "./repl.ts";
import { App } from "./ui/App.tsx";
import { promptForApiKeyWithInk } from "./ui/SetupPrompt.tsx";
import { ThemeProvider } from "./ui/ThemeContext.tsx";
import { getActiveTheme, selectTheme, setActiveTheme } from "./ui/themes.ts";

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const USAGE = `drexler — CLI chat with corporate-exec persona

Usage: drexler [options]

Options:
  --model <31b|26b|id>           model alias or full OpenRouter id
  --persona <path>               custom persona markdown
  --theme <name>                 color theme (default apollo)
  --no-intro                     skip startup banner and mascot
  --fast                         fast startup mode, implies --no-intro
  --resume                       restore the prior session's transcript
  --version, -v                  print version
  --help, -h                     this help

Slash commands inside REPL:
  /help          show directives
  /clear         reset conversation
  /exit          exit
  /synergy       SYNERGY!
  /pet [on|off]  toggle pet dashboard mode
  /feed          feed Drexler a deal memo
  /play          corporate synergy game (flexing included)
  /work          Drexler grinds the pipeline
  /rest          strategic nap (restores energy)
  /praise        affirm Drexler's contributions
  /vibe          let Drexler choose his own adventure
  /name [name]   view or assign Drexler's pet name
  /profile       print Drexler's personnel file
  /model [id]    show or switch model
  /theme [name]  show or switch theme; append save to persist
  /startup [mode] persist startup mode: fast, no-intro, normal
  /history       message + token count
  /regenerate    re-roll last response
  /redo          alias for /regenerate
  /retry [style] re-roll last response as terse or brutal
  /expand        print latest response
  /quote         quote latest response
  /search <term> search transcript
  /export <fmt> [path] export md, txt, json, or html
  /save [path]   archive conversation as markdown
  /save-last [path] save latest response
  /copy [n]      copy a message to clipboard (default: last)
  /copy-last     alias for /copy
  /edit [n]      load a prior user message into the draft
  /setup         show config + API key source
  /update        show upgrade instructions
  /auth <key>    replace API key in-session (no restart)

Ctrl+C exits gracefully.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }

  const isInteractive = process.stdout.isTTY === true && process.stdin.isTTY === true;

  // 1. Validate non-secret config FIRST so a bogus --model or --persona
  //    fails fast before we ask the user for an API key.
  try {
    await validateLaunchConfig(argv);
  } catch (e) {
    if (e instanceof LaunchConfigError) {
      console.error(error(formatLaunchError(e)));
    } else {
      console.error(error(`Drexler config tantrum: ${e instanceof Error ? e.message : e}`));
    }
    process.exit(1);
  }

  // 2. Acquire API key (may prompt). Runs after validation so bad CLI args
  //    no longer trigger the first-run setup flow.
  await ensureApiKey({
    prompt: isInteractive ? promptForApiKeyWithInk : undefined,
  });

  // 3. Resolve full Config (API key now present).
  let config;
  try {
    config = await resolveConfig(argv);
  } catch (e) {
    if (e instanceof LaunchConfigError) {
      console.error(error(formatLaunchError(e)));
    } else {
      console.error(error(`Drexler config tantrum: ${e instanceof Error ? e.message : e}`));
    }
    process.exit(1);
  }

  // resolveConfig already merged flag > env > file into config.theme.
  // selectTheme just applies NO_COLOR override + default fallback.
  const themeName = selectTheme({ flag: config.theme });
  setActiveTheme(themeName);
  resetMarkedTheme(); // ensure markdown picks up the freshly chosen theme

  // T12: lazy persona. Kick off the disk read immediately so it
  // overlaps with mood/resume/intro setup, but don't await until the
  // consumer (Conversation system prompt, greeting) actually needs it.
  const persona = loadPersonaLazy(config.personaPath);
  persona.preload();

  const mood = pickMood();
  let systemPrompt: string;
  let greetings: string[];
  try {
    [systemPrompt, greetings] = await Promise.all([persona.system(), persona.openers()]);
  } catch (e) {
    console.error(error(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
  const systemPromptWithMood = systemPrompt + moodLine(mood);
  const greeting = pickGreeting(greetings);

  const conversation = new Conversation(systemPromptWithMood, config.maxHistory);

  // --resume restores the prior session's user/assistant turns into the
  // freshly-built conversation. System prompt stays current (mood may
  // have changed), so we only rehydrate the body. Best-effort — a
  // missing or corrupt save file is a silent no-op.
  if (argv.includes("--resume")) {
    const { loadSavedSession, describeSession, formatSessionAge } =
      await import("./conversation/persist.ts");
    const saved = loadSavedSession();
    if (saved) {
      for (const m of saved.messages) {
        if (m.role === "user" || m.role === "assistant") {
          conversation.push(m.role, m.content);
        }
      }
      const preview = describeSession(saved);
      console.log(
        infoLine() +
          `  ·  resumed ${preview.messageCount} message${
            preview.messageCount === 1 ? "" : "s"
          } from ${formatSessionAge(saved.savedAt)}`,
      );
    } else {
      console.log(infoLine() + "  ·  no saved session to resume");
    }
  }

  const skipIntro = config.noIntro === true || config.fast === true;

  if (isInteractive) {
    if (!skipIntro) {
      console.log("");
      await typewriterBanner();
      console.log(tagline());
    }

    const { waitUntilExit } = render(
      React.createElement(ThemeProvider, {
        value: getActiveTheme(),
        children: React.createElement(App, {
          conversation,
          config,
          mood,
          greeting,
          showIntroChrome: !skipIntro,
        }),
      }),
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
    // Belt-and-braces: the unmount effect inside App already kicks off
    // a flushPetSaves, but if waitUntilExit() resolves before that
    // microtask settles, the pet queue may still have pending work.
    // Await an explicit drain (timeout-capped) before main() returns.
    await flushPetSaves();
    return;
  }

  // Non-TTY fallback: linear output, readline-based REPL.
  installFatalHandlers();
  console.log("");
  if (!skipIntro) {
    console.log(banner());
    console.log(tagline());
    console.log("");
    console.log(welcomeBox(greeting, termCols()));
    console.log("");
  }
  console.log("  " + infoLine() + "  ·  mood: " + mood);
  console.log("");

  await startRepl({
    conversation,
    config,
    print: (s) => console.log(s),
  });
  // If startRepl returns normally (stdin EOF, not a process.exit path),
  // drain any pending pet writes before the process unwinds.
  await flushPetSaves();
}

function formatLaunchError(e: LaunchConfigError): string {
  switch (e.reason) {
    case "model-alias":
      return `Bad model alias: ${e.message}`;
    case "persona-path":
      return `Bad persona file: ${e.message}`;
    case "config-unreadable":
      return `Config file unreadable: ${e.message}`;
    case "api-key-empty":
      return `API key required: ${e.message}`;
  }
}

// Schedule a pet-save drain before exiting. We can't `await` inside a
// synchronous signal/exception handler, so we kick off the flush, set a
// hard cap, and call process.exit when whichever finishes first
// resolves. The drain is best-effort: a stuck writer should not block
// teardown longer than `flushPetSaves`'s own 2s timeout.
function exitWithPetFlush(code: number): void {
  let exited = false;
  const done = (): void => {
    if (exited) return;
    exited = true;
    process.exit(code);
  };
  // Hard cap matches flushPetSaves's default + small jitter so a hang
  // in the timeout race itself can't strand the process.
  const hardCap = setTimeout(done, 2_500);
  if (typeof hardCap.unref === "function") hardCap.unref();
  flushPetSaves().then(done, done);
}

// Fatal handlers are installed only in the non-TTY path; the interactive
// path lets Ink's signal-exit hooks run cleanup so the alt-screen restores.
function installFatalHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    console.error(error("Unhandled rejection:"), msg);
    process.exitCode = 1;
    exitWithPetFlush(1);
  });
  process.on("uncaughtException", (err) => {
    console.error(error("Uncaught exception:"), err.stack ?? err.message);
    process.exitCode = 1;
    exitWithPetFlush(1);
  });
  // Non-Ink REPL path: readline's SIGINT handler in repl.ts calls
  // process.exit(0) synchronously. Front-run it with a process-level
  // handler so the pet save queue gets a chance to drain. SIGTERM is
  // covered too — supervisors (systemd, pm2) prefer it for graceful
  // shutdown.
  const signalHandler = (): void => {
    exitWithPetFlush(0);
  };
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
}

main().catch((e) => {
  console.error(error("Fatal:"), e);
  exitWithPetFlush(1);
});
