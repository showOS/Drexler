import { existsSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { resolveModel } from "./config.ts";
import type { Conversation } from "./conversation.ts";
import { error } from "./renderer.ts";
import type { Config } from "./types.ts";

export type CommandAction =
  | { type: "continue" }
  | { type: "exit"; message?: string }
  | { type: "regenerate" };

interface CommandContext {
  conversation: Conversation;
  config: Config;
  print: (s: string) => void;
}

const HELP_TEXT = `New memo to staff! Drexler permit following directives:
  /help          - this memo
  /clear         - shred all documents (reset history)
  /exit          - meeting adjourned
  /synergy       - SYNERGY!
  /model         - show or switch model (e.g. /model 26b)
  /history       - count messages and approximate tokens
  /regenerate    - re-roll Drexler's last response
  /save [path]   - archive conversation to markdown file`;

const WHITESPACE_RE = /\s+/;

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
}

export const COMMAND_PALETTE: ReadonlyArray<SlashCommand> = [
  { name: "/help", description: "Show directives" },
  { name: "/clear", description: "Reset conversation" },
  { name: "/exit", description: "Adjourn meeting" },
  { name: "/synergy", description: "SYNERGY!" },
  { name: "/model", description: "Show or switch model" },
  { name: "/history", description: "Message + token count" },
  { name: "/regenerate", description: "Re-roll last response" },
  { name: "/save", description: "Archive conversation as markdown" },
];

export function filterPaletteByPrefix(
  input: string,
): ReadonlyArray<SlashCommand> {
  if (!input.startsWith("/") || input.includes(" ")) return [];
  const prefix = input.toLowerCase();
  return COMMAND_PALETTE.filter((c) =>
    c.name.toLowerCase().startsWith(prefix),
  );
}

export function isSlash(input: string): boolean {
  return input.startsWith("/");
}

export function parseSlash(input: string): { name: string; args: string[] } {
  const trimmed = input.slice(1).trim();
  if (trimmed === "") return { name: "", args: [] };
  const parts = trimmed.split(WHITESPACE_RE);
  return {
    name: (parts[0] ?? "").toLowerCase(),
    args: parts.slice(1),
  };
}

function commandRemainder(input: string, name: string): string {
  const body = input.slice(1).trim();
  return body.slice(name.length).trim();
}

function stripMatchingQuotes(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }
  return input;
}

export function dispatch(input: string, ctx: CommandContext): CommandAction {
  const { name, args } = parseSlash(input);
  switch (name) {
    case "help":
      ctx.print(HELP_TEXT);
      return { type: "continue" };

    case "clear":
      ctx.conversation.clear();
      ctx.print("Drexler shred all documents. IRS jealous.");
      return { type: "continue" };

    case "exit":
      return {
        type: "exit",
        message:
          "Fine. Drexler have other meetings. More important ones. Meeting adjourned.",
      };

    case "synergy":
      ctx.print("SYNERGY. You promoted. Award: continued employment.");
      return { type: "continue" };

    case "model":
      handleModel(args, ctx);
      return { type: "continue" };

    case "history":
      ctx.print(
        `Drexler ledger: ${ctx.conversation.length} message${
          ctx.conversation.length === 1 ? "" : "s"
        }, ~${ctx.conversation.approximateTokens()} tokens.`,
      );
      return { type: "continue" };

    case "regenerate":
    case "redo":
    case "retry": {
      const last = ctx.conversation.lastUserMessage();
      if (!last) {
        ctx.print("Drexler need input first. State concern.");
        return { type: "continue" };
      }
      ctx.conversation.popLastAssistant();
      ctx.print("Drexler reconsidering. Stand by.");
      return { type: "regenerate" };
    }

    case "save": {
      const pathArg = stripMatchingQuotes(commandRemainder(input, name));
      if (pathArg && pathArg.split(/[/\\]/).includes("..")) {
        ctx.print(
          error(`Invalid path: ${pathArg} (no '..' segments allowed).`),
        );
        return { type: "continue" };
      }
      const target = pathArg
        ? pathResolve(pathArg)
        : pathResolve(`drexler-${Date.now()}.md`);
      if (!target.toLowerCase().endsWith(".md")) {
        ctx.print(error(`Save target must end in .md: ${target}`));
        return { type: "continue" };
      }
      if (existsSync(target)) {
        ctx.print(
          error(
            `File exists: ${target}. Refuse to overwrite. Use a different path.`,
          ),
        );
        return { type: "continue" };
      }
      try {
        writeFileSync(target, formatConversationAsMarkdown(ctx.conversation));
        ctx.print(`Drexler archive sealed: ${target}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.print(error(`Could not save: ${msg}`));
      }
      return { type: "continue" };
    }

    default:
      ctx.print(
        "Drexler not recognize that corporate directive. Try /help.",
      );
      return { type: "continue" };
  }
}

function formatConversationAsMarkdown(conv: Conversation): string {
  const snap = conv.snapshot();
  const lines: string[] = [
    `# Drexler Conversation`,
    ``,
    `Saved: ${new Date().toISOString()}`,
    `Messages: ${conv.length}`,
    ``,
    `---`,
    ``,
  ];
  for (const m of snap) {
    if (m.role === "system") continue;
    const heading = m.role === "user" ? "## You" : "## Drexler";
    lines.push(heading, "", m.content, "", "---", "");
  }
  return lines.join("\n");
}

function handleModel(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    ctx.print(`Current model: ${ctx.config.model}`);
    return;
  }
  try {
    const resolved = resolveModel(args[0]!);
    ctx.config.model = resolved;
    ctx.print(`Drexler now consult model: ${resolved}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.print(error(msg));
  }
}
