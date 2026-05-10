#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render } from "ink";
import { ensureApiKey, resolveConfig } from "./config.ts";
import { Conversation } from "./conversation.ts";
import { moodLine, pickMood } from "./mood.ts";
import { loadPersona, pickGreeting } from "./persona.ts";
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
import { startRepl } from "./repl.ts";
import { App } from "./ui/App.tsx";
import { MascotIntro } from "./ui/MascotIntro.tsx";
import { promptForApiKeyWithInk } from "./ui/SetupPrompt.tsx";
import { ThemeProvider } from "./ui/ThemeContext.tsx";
import { getActiveTheme, selectTheme, setActiveTheme } from "./ui/themes.ts";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"),
    );
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
  --version, -v                  print version
  --help, -h                     this help

Slash commands inside REPL:
  /help          show directives
  /clear         reset conversation
  /exit          exit
  /synergy       SYNERGY!
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
  /copy-last     copy latest response to clipboard

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

  const isInteractive =
    process.stdout.isTTY === true && process.stdin.isTTY === true;

  // Acquire API key. Prompts interactively if missing — runs BEFORE banner.
  await ensureApiKey({
    prompt: isInteractive ? promptForApiKeyWithInk : undefined,
  });

  let config;
  try {
    config = await resolveConfig(argv);
  } catch (e) {
    console.error(
      error(`Drexler config tantrum: ${e instanceof Error ? e.message : e}`),
    );
    process.exit(1);
  }

  // resolveConfig already merged flag > env > file into config.theme.
  // selectTheme just applies NO_COLOR override + default fallback.
  const themeName = selectTheme({ flag: config.theme });
  setActiveTheme(themeName);
  resetMarkedTheme(); // ensure markdown picks up the freshly chosen theme

  let persona;
  try {
    persona = await loadPersona(config.personaPath);
  } catch (e) {
    console.error(error(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  const mood = pickMood();
  const systemPromptWithMood = persona.systemPrompt + moodLine(mood);
  const greeting = pickGreeting(persona.greetings);

  const conversation = new Conversation(
    systemPromptWithMood,
    config.maxHistory,
  );
  const skipIntro = config.noIntro === true || config.fast === true;

  if (isInteractive) {
    if (!skipIntro) {
      // Print intro to stdout before Ink mounts. Ink's <Static> can't host
      // animated state, and we want the banner visible from boot.
      console.log("");
      await typewriterBanner();
      console.log(tagline());
      console.log("");
      // Animated welcome card via transient Ink instance.
      const intro = render(
        React.createElement(ThemeProvider, {
          value: getActiveTheme(),
          children: React.createElement(MascotIntro, { greeting }),
        }),
        { exitOnCtrlC: false },
      );
      await intro.waitUntilExit();
      intro.unmount();
    }

    console.log("");
    console.log("  " + infoLine() + "  ·  mood: " + mood);
    console.log("");

    const { waitUntilExit } = render(
      React.createElement(ThemeProvider, {
        value: getActiveTheme(),
        children: React.createElement(App, { conversation, config, mood }),
      }),
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
    return;
  }

  // Non-TTY fallback: linear output, readline-based REPL.
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
}

main().catch((e) => {
  console.error(error("Fatal:"), e);
  process.exit(1);
});
