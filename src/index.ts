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
  typewriterBanner,
  welcomeBox,
} from "./renderer.ts";
import { startRepl } from "./repl.ts";
import { App } from "./ui/App.tsx";

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
  --model <31b|26b|id>   model alias or full OpenRouter id
  --persona <path>       custom persona markdown
  --version, -v          print version
  --help, -h             this help

Slash commands inside REPL:
  /help          show directives
  /clear         reset conversation
  /exit          exit
  /synergy       SYNERGY!
  /model [id]    show or switch model
  /history       message + token count
  /regenerate    re-roll last response
  /save [path]   archive conversation as markdown

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

  // Acquire API key. Prompts interactively if missing — runs BEFORE banner.
  await ensureApiKey();

  let config;
  try {
    config = await resolveConfig(argv);
  } catch (e) {
    console.error(
      error(`Drexler config tantrum: ${e instanceof Error ? e.message : e}`),
    );
    process.exit(1);
  }

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

  const isInteractive =
    process.stdout.isTTY === true && process.stdin.isTTY === true;

  if (isInteractive) {
    // Print intro to stdout before Ink mounts. Ink's <Static> can't host
    // animated state, and we want the banner visible from boot.
    console.log("");
    await typewriterBanner();
    console.log("");
    console.log(welcomeBox(greeting));
    console.log("");
    console.log("  " + infoLine() + "  ·  mood: " + mood);
    console.log("");

    const { waitUntilExit } = render(
      React.createElement(App, { conversation, config }),
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
    return;
  }

  // Non-TTY fallback: linear output, readline-based REPL.
  console.log("");
  console.log(banner());
  console.log("");
  console.log(welcomeBox(greeting));
  console.log("");
  console.log(infoLine() + "  ·  mood: " + mood);
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
