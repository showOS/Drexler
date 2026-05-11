import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import {
  getConfigPath,
  getDrexlerVersion,
  getResolvedConfigPath,
  isValidApiKey,
  resolveModel,
} from "./config.ts";
import type { Conversation } from "./conversation.ts";
import { error, resetMarkedTheme } from "./renderer.ts";
import { THEME_NAMES, type Config, type ThemeName } from "./types.ts";
import {
  getActiveTheme,
  isThemeName,
  setActiveTheme,
  THEMES,
} from "./ui/themes.ts";

export type CommandAction =
  | { type: "continue"; persistConfig?: Partial<Config> }
  | { type: "exit"; message?: string }
  | { type: "regenerate"; instruction?: string; removedAssistant: boolean };

export type CommandGroup =
  | "directives"
  | "themes"
  | "models"
  | "startup"
  | "retry"
  | "export";

interface CommandContext {
  conversation: Conversation;
  config: Config;
  print: (s: string) => void;
  copyToClipboard?: (text: string) => ClipboardResult;
}

type ClipboardResult =
  | { ok: true; command: string }
  | { ok: false; reason: string };

const HELP_TEXT = `New memo to staff! Drexler permit following directives:
  /help          - this memo
  /clear         - shred all documents (reset history)
  /exit          - meeting adjourned
  /synergy       - SYNERGY!
  /feed          - feed Drexler a deal memo
  /play          - corporate synergy game with Drexler
  /work          - Drexler grinds the deal pipeline
  /praise        - affirm Drexler's contributions
  /rest          - Drexler takes a strategic nap
  /vibe          - let Drexler choose his own adventure
  /name [name]   - view or assign Drexler's pet name
  /profile       - print Drexler's personnel file
  /model         - show or switch model (e.g. /model 26b)
  /theme         - show or switch theme (${THEME_NAMES.join(", ")})
  /startup       - persist startup mode (fast, no-intro, normal)
  /history       - count messages and approximate tokens
  /regenerate    - re-roll Drexler's last response
  /redo          - alias for /regenerate
  /retry [style] - re-roll last response, optionally terse or brutal
  /expand        - print Drexler's latest response
  /quote         - quote Drexler's latest response
  /search <term> - search this meeting transcript
  /export <fmt> [path] - export as md, txt, json, or html
  /save [path]   - archive conversation to markdown file
  /save-last [path] - save Drexler's last response
  /copy-last     - copy Drexler's last response to clipboard
  /setup         - show config + API key source
  /update        - show upgrade instructions`;

const WHITESPACE_RE = /\s+/;

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly hint?: string;
  readonly group?: CommandGroup;
}

export const COMMAND_PALETTE: ReadonlyArray<SlashCommand> = [
  { name: "/help", description: "Show directives", group: "directives" },
  { name: "/clear", description: "Reset conversation", group: "directives" },
  { name: "/exit", description: "Adjourn meeting", group: "directives" },
  { name: "/synergy", description: "SYNERGY!", group: "directives" },
  { name: "/feed", description: "Feed Drexler a deal memo", group: "directives" },
  { name: "/play", description: "Play with Drexler", group: "directives" },
  { name: "/work", description: "Drexler grinds deals", group: "directives" },
  { name: "/praise", description: "Affirm Drexler", group: "directives" },
  { name: "/rest", description: "Drexler takes a strategic nap", group: "directives" },
  { name: "/vibe", description: "Drexler chooses his own adventure", group: "directives" },
  { name: "/name", description: "Issue or view Drexler's pet name", group: "directives" },
  { name: "/profile", description: "Print Drexler's personnel file", group: "directives" },
  { name: "/model", description: "Show or switch model", group: "models" },
  { name: "/theme", description: "Show or switch theme", group: "themes" },
  { name: "/startup", description: "Persist startup mode", group: "startup" },
  { name: "/history", description: "Message + token count", group: "directives" },
  { name: "/regenerate", description: "Re-roll last response", group: "directives" },
  { name: "/redo", description: "Alias for regenerate", group: "directives" },
  { name: "/retry", description: "Retry terse or brutal", group: "retry" },
  { name: "/expand", description: "Print last response", group: "directives" },
  { name: "/quote", description: "Quote last response", group: "directives" },
  { name: "/search", description: "Search transcript", group: "directives" },
  { name: "/export", description: "Export md, txt, json, or html", group: "export" },
  { name: "/save", description: "Archive conversation as markdown", group: "directives" },
  { name: "/save-last", description: "Save last Drexler response", group: "directives" },
  { name: "/copy-last", description: "Copy last response", group: "directives" },
  { name: "/setup", description: "Show config + key source", group: "directives" },
  { name: "/update", description: "Show upgrade instructions", group: "directives" },
];

const THEME_PALETTE_COPY: Record<
  ThemeName,
  { readonly description: string; readonly hint: string }
> = {
  apollo: {
    description: "Signature Drexler green",
    hint: "default executive terminal",
  },
  amber: {
    description: "Warm amber deal glow",
    hint: "low-light command room",
  },
  mono: {
    description: "Plain high-contrast text",
    hint: "NO_COLOR friendly",
  },
  terminal: {
    description: "Classic ANSI terminal",
    hint: "green/cyan legacy mode",
  },
  dealroom: {
    description: "Teal boardroom desk",
    hint: "quiet professional palette",
  },
  midnight: {
    description: "Cool blue night desk",
    hint: "focused late-session work",
  },
  paper: {
    description: "Clean document mode",
    hint: "bright memo-style contrast",
  },
  plasma: {
    description: "Magenta trading floor",
    hint: "high-energy neon accent",
  },
};

const ARGUMENT_PALETTE: ReadonlyArray<{
  readonly command: string;
  readonly baseDescription: string;
  readonly baseHint: string;
  readonly values: ReadonlyArray<SlashCommand>;
}> = [
  {
    command: "/theme",
    baseDescription: "Theme chooser",
    baseHint: "select a look below",
    values: [
      ...THEME_NAMES.map((name) => {
        const copy = THEME_PALETTE_COPY[name];
        return {
          name: `/theme ${name}`,
          description: copy.description,
          hint: copy.hint,
        };
      }),
      {
        name: "/theme save",
        description: "Persist current theme",
        hint: "use after previewing",
      },
    ],
  },
  {
    command: "/startup",
    baseDescription: "Startup mode chooser",
    baseHint: "pick launch behavior",
    values: [
      {
        name: "/startup fast",
        description: "Persist fast startup",
        hint: "skip ceremony",
      },
      {
        name: "/startup no-intro",
        description: "Skip intro on launch",
        hint: "keep normal runtime",
      },
      {
        name: "/startup normal",
        description: "Restore full intro",
        hint: "show full opening",
      },
    ],
  },
  {
    command: "/retry",
    baseDescription: "Retry style chooser",
    baseHint: "reshape last answer",
    values: [
      {
        name: "/retry terse",
        description: "Retry in two sentences",
        hint: "short and direct",
      },
      {
        name: "/retry brutal",
        description: "Retry more forcefully",
        hint: "sharper critique",
      },
    ],
  },
  {
    command: "/export",
    baseDescription: "Export format chooser",
    baseHint: "pick transcript output",
    values: [
      {
        name: "/export md",
        description: "Export markdown transcript",
        hint: "portable notes",
      },
      {
        name: "/export txt",
        description: "Export plain text transcript",
        hint: "clean copy",
      },
      {
        name: "/export json",
        description: "Export structured JSON",
        hint: "machine-readable",
      },
      {
        name: "/export html",
        description: "Export printable HTML",
        hint: "browser-ready memo",
      },
    ],
  },
  {
    command: "/model",
    baseDescription: "Model chooser",
    baseHint: "select inference desk",
    values: [
      {
        name: "/model 31b",
        description: "Use primary 31b model",
        hint: "best default",
      },
      {
        name: "/model 26b",
        description: "Use fallback 26b model",
        hint: "faster backup",
      },
    ],
  },
];

function filterArgumentPalette(input: string): ReadonlyArray<SlashCommand> {
  const lower = input.toLowerCase();
  for (const group of ARGUMENT_PALETTE) {
    if (lower === group.command) {
      return [
        {
          name: group.command,
          description: group.baseDescription,
          hint: group.baseHint,
        },
        ...group.values,
      ];
    }
    const prefix = `${group.command} `;
    if (!lower.startsWith(prefix)) continue;
    const argPrefix = lower.slice(prefix.length);
    return group.values.filter((item) =>
      item.name.toLowerCase().startsWith(lower),
    ).filter((item) => {
      if (argPrefix.trim() === "") return true;
      return item.name.toLowerCase().slice(prefix.length).startsWith(argPrefix);
    });
  }
  return [];
}

export function filterPaletteByPrefix(
  input: string,
): ReadonlyArray<SlashCommand> {
  if (!input.startsWith("/")) return [];
  const exactArgumentPalette = filterArgumentPalette(input);
  if (exactArgumentPalette.length > 0) return exactArgumentPalette;
  if (input.includes(" ")) return filterArgumentPalette(input);
  const prefix = input.toLowerCase();
  return COMMAND_PALETTE.filter((c) =>
    c.name.toLowerCase().startsWith(prefix),
  );
}

const ARGUMENT_BASE_NAMES: ReadonlySet<string> = new Set(
  ARGUMENT_PALETTE.map((g) => g.command),
);

/**
 * True if `name` is a bare command (no space) that has child argument
 * suggestions. Palette Enter on such a name should NOT execute — it should
 * open the chooser.
 */
export function isArgumentParentCommand(name: string): boolean {
  if (!name.startsWith("/")) return false;
  if (name.includes(" ")) return false;
  return ARGUMENT_BASE_NAMES.has(name.toLowerCase());
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
      ctx.print(
        "SYNERGY EVENT: alignment protocol completed. Award: continued employment.",
      );
      return { type: "continue" };

    case "feed":
    case "play":
    case "work":
    case "praise":
    case "rest":
    case "vibe":
    case "name":
    case "profile":
      ctx.print(
        "Drexler pet directives require the interactive deal desk. Launch Drexler in a TTY.",
      );
      return { type: "continue" };

    case "model":
      handleModel(args, ctx);
      return { type: "continue" };

    case "theme":
      return handleTheme(args, ctx);

    case "startup":
      return handleStartup(args, ctx);

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
      if (name === "retry" && args.length > 0) {
        const style = args[0]?.toLowerCase();
        if (style === "terse" || style === "brutal") {
          const instruction =
            style === "terse"
              ? "Regenerate the previous answer. Make it terse, direct, and no longer than two sentences."
              : "Regenerate the previous answer. Make it sharper, more skeptical, and more forceful while staying useful.";
          const removedAssistant = ctx.conversation.popLastAssistant();
          ctx.print(`Drexler reconsidering. Style mandate: ${style}.`);
          return { type: "regenerate", instruction, removedAssistant };
        }
        ctx.print(error(`Unknown retry style: ${args[0]}. Use terse or brutal.`));
        return { type: "continue" };
      }
      const removedAssistant = ctx.conversation.popLastAssistant();
      ctx.print("Drexler reconsidering. Stand by.");
      return { type: "regenerate", removedAssistant };
    }

    case "expand":
      handleExpand(ctx);
      return { type: "continue" };

    case "quote":
      handleQuote(ctx);
      return { type: "continue" };

    case "search":
      handleSearch(commandRemainder(input, name), ctx);
      return { type: "continue" };

    case "export":
      handleExport(input, args, ctx);
      return { type: "continue" };

    case "save": {
      const pathArg = stripMatchingQuotes(commandRemainder(input, name));
      const target = resolveWriteTarget(pathArg, "drexler", ".md", ctx);
      if (!target) return { type: "continue" };
      try {
        writeFileSync(
          target,
          formatConversationAsMarkdown(ctx.conversation, ctx.config),
        );
        ctx.print(`Drexler archive sealed: ${target}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.print(error(`Could not save: ${msg}`));
      }
      return { type: "continue" };
    }

    case "save-last": {
      handleSaveLast(commandRemainder(input, name), ctx);
      return { type: "continue" };
    }

    case "copy-last": {
      handleCopyLast(ctx);
      return { type: "continue" };
    }

    case "setup":
      handleSetup(ctx);
      return { type: "continue" };

    case "update":
      handleUpdate(ctx);
      return { type: "continue" };

    default:
      ctx.print(
        "Drexler not recognize that corporate directive. Try /help.",
      );
      return { type: "continue" };
  }
}

function resolveWriteTarget(
  pathArg: string,
  defaultPrefix: string,
  requiredExt: string,
  ctx: CommandContext,
): string | null {
  if (pathArg && pathArg.split(/[/\\]/).includes("..")) {
    ctx.print(error(`Invalid path: ${pathArg} (no '..' segments allowed).`));
    return null;
  }
  const target = pathArg
    ? pathResolve(pathArg)
    : pathResolve(`${defaultPrefix}-${Date.now()}${requiredExt}`);
  if (!target.toLowerCase().endsWith(requiredExt)) {
    ctx.print(error(`Target must end in ${requiredExt}: ${target}`));
    return null;
  }
  if (existsSync(target)) {
    ctx.print(
      error(`File exists: ${target}. Refuse to overwrite. Use a different path.`),
    );
    return null;
  }
  return target;
}

function exportMetadata(conv: Conversation, config: Config): string[] {
  return [
    `Saved: ${new Date().toISOString()}`,
    `Messages: ${conv.length}`,
    `Approx tokens: ${conv.approximateTokens()}`,
    `Model: ${config.model}`,
    `Theme: ${config.theme ?? currentThemeName(config)}`,
  ];
}

function formatConversationAsMarkdown(
  conv: Conversation,
  config: Config,
): string {
  const snap = conv.snapshot();
  const lines: string[] = [
    `# Drexler Conversation`,
    ``,
    ...exportMetadata(conv, config),
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

function formatConversationAsText(conv: Conversation, config: Config): string {
  const snap = conv.snapshot();
  const lines: string[] = [
    "Drexler Conversation",
    ...exportMetadata(conv, config),
    "",
  ];
  for (const m of snap) {
    if (m.role === "system") continue;
    const heading = m.role === "user" ? "You" : "Drexler";
    lines.push(`[${heading}]`, m.content, "");
  }
  return lines.join("\n");
}

function formatConversationAsJson(conv: Conversation, config: Config): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      messageCount: conv.length,
      approximateTokens: conv.approximateTokens(),
      model: config.model,
      theme: config.theme ?? currentThemeName(config),
      messages: conv.snapshot().filter((m) => m.role !== "system"),
    },
    null,
    2,
  );
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatConversationAsHtml(conv: Conversation, config: Config): string {
  const exportedAt = new Date().toISOString();
  const theme = config.theme ?? currentThemeName(config);
  const rows = conv
    .snapshot()
    .filter((m) => m.role !== "system")
    .map((m) => {
      const label = m.role === "user" ? "You" : "Drexler";
      return `<article class="message ${m.role}"><h2>${label}</h2><div>${escapeHtml(
        m.content,
      ).replaceAll("\n", "<br>")}</div></article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drexler Conversation</title>
<style>
:root { color-scheme: dark; --bg: #101216; --panel: #171a21; --line: #303846; --text: #f6f1e8; --muted: #aeb6c4; --gold: #d6b25e; --blue: #8ab4f8; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 44px 24px 56px; }
header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 18px; }
h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: 0; }
.meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; }
.message { border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; margin: 16px 0; background: var(--panel); break-inside: avoid; }
.message h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
.message.user h2 { color: var(--blue); }
@media print {
  :root { color-scheme: light; --bg: #ffffff; --panel: #ffffff; --line: #d7dce5; --text: #111827; --muted: #4b5563; --gold: #7c5600; --blue: #174ea6; }
  main { padding: 24px 0; max-width: none; }
}
</style>
</head>
<body>
<main>
<header>
<h1>Drexler Conversation</h1>
<div class="meta">
  <span>Exported ${escapeHtml(exportedAt)}</span>
  <span>${conv.length} messages</span>
  <span>~${conv.approximateTokens()} tokens</span>
  <span>Model ${escapeHtml(config.model)}</span>
  <span>Theme ${escapeHtml(theme)}</span>
</div>
</header>
${rows || "<p>No transcript yet.</p>"}
</main>
</body>
</html>
`;
}

function lastAssistantMessage(conv: Conversation): string | null {
  const snap = conv.snapshot();
  for (let i = snap.length - 1; i >= 0; i--) {
    const m = snap[i];
    if (m?.role === "assistant") return m.content;
  }
  return null;
}

function formatLastAssistantAsMarkdown(content: string): string {
  return [
    "# Drexler Last Response",
    "",
    `Saved: ${new Date().toISOString()}`,
    "",
    "---",
    "",
    content,
    "",
  ].join("\n");
}

function handleSaveLast(rawPath: string, ctx: CommandContext): void {
  const last = lastAssistantMessage(ctx.conversation);
  if (!last) {
    ctx.print("Drexler has not issued a response to save yet.");
    return;
  }
  const target = resolveWriteTarget(
    stripMatchingQuotes(rawPath.trim()),
    "drexler-last",
    ".md",
    ctx,
  );
  if (!target) return;
  try {
    writeFileSync(target, formatLastAssistantAsMarkdown(last));
    ctx.print(`Drexler last response sealed: ${target}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.print(error(`Could not save last response: ${msg}`));
  }
}

function handleExpand(ctx: CommandContext): void {
  const last = lastAssistantMessage(ctx.conversation);
  if (!last) {
    ctx.print("Drexler has no response to expand yet.");
    return;
  }
  ctx.print(last);
}

function handleQuote(ctx: CommandContext): void {
  const last = lastAssistantMessage(ctx.conversation);
  if (!last) {
    ctx.print("Drexler has no response to quote yet.");
    return;
  }
  const quoted = last
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  ctx.print(quoted);
}

export function copyTextToClipboard(text: string): ClipboardResult {
  const candidates =
    process.platform === "darwin"
      ? [{ command: "pbcopy", args: [] }]
      : process.platform === "win32"
        ? [{ command: "cmd.exe", args: ["/c", "clip"] }]
        : [
            { command: "wl-copy", args: [] },
            { command: "xclip", args: ["-selection", "clipboard"] },
            { command: "xsel", args: ["--clipboard", "--input"] },
          ];

  const failures: string[] = [];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (result.status === 0) {
      return { ok: true, command: candidate.command };
    }
    if (result.error) {
      failures.push(`${candidate.command}: ${result.error.message}`);
    } else if (result.stderr) {
      failures.push(`${candidate.command}: ${String(result.stderr).trim()}`);
    } else {
      failures.push(`${candidate.command}: exit ${result.status ?? "unknown"}`);
    }
  }

  return {
    ok: false,
    reason: failures.length > 0 ? failures.join("; ") : "no clipboard utility found",
  };
}

function handleCopyLast(ctx: CommandContext): void {
  const last = lastAssistantMessage(ctx.conversation);
  if (!last) {
    ctx.print("Drexler has not issued a response to copy yet.");
    return;
  }

  const result = (ctx.copyToClipboard ?? copyTextToClipboard)(last);
  if (result.ok) {
    ctx.print(`Drexler copied last response to clipboard via ${result.command}.`);
    return;
  }

  ctx.print(
    error(
      `Clipboard unavailable: ${result.reason}. Use /save-last [path] to archive Drexler's last response.`,
    ),
  );
}

function compactSnippet(content: string, term: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const idx = normalized.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return normalized.slice(0, 96);
  const start = Math.max(0, idx - 32);
  const end = Math.min(normalized.length, idx + term.length + 48);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function handleSearch(rawTerm: string, ctx: CommandContext): void {
  const term = stripMatchingQuotes(rawTerm.trim());
  if (!term) {
    ctx.print(error("Usage: /search <term>"));
    return;
  }

  const matches = ctx.conversation
    .snapshot()
    .filter((m) => m.role !== "system" && m.content.toLowerCase().includes(term.toLowerCase()));

  if (matches.length === 0) {
    ctx.print(`No transcript matches for "${term}".`);
    return;
  }

  const lines = [`Search results for "${term}": ${matches.length}`];
  matches.slice(0, 8).forEach((m, i) => {
    const label = m.role === "user" ? "You" : "Drexler";
    lines.push(`${i + 1}. ${label}: ${compactSnippet(m.content, term)}`);
  });
  if (matches.length > 8) {
    lines.push(`...${matches.length - 8} more matches`);
  }
  ctx.print(lines.join("\n"));
}

type ExportFormat = "md" | "txt" | "json" | "html";

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  md: ".md",
  txt: ".txt",
  json: ".json",
  html: ".html",
};

function isExportFormat(value: string | undefined): value is ExportFormat {
  return value === "md" || value === "txt" || value === "json" || value === "html";
}

function handleExport(input: string, args: string[], ctx: CommandContext): void {
  const requested = args[0]?.toLowerCase();
  if (!isExportFormat(requested)) {
    ctx.print(error("Usage: /export md|txt|json|html [path]"));
    return;
  }

  const rawRemainder = commandRemainder(input, "export");
  const rawPath = rawRemainder.slice(args[0]!.length).trim();
  const target = resolveWriteTarget(
    stripMatchingQuotes(rawPath),
    `drexler-export`,
    EXPORT_EXTENSIONS[requested],
    ctx,
  );
  if (!target) return;

  const body =
    requested === "md"
      ? formatConversationAsMarkdown(ctx.conversation, ctx.config)
      : requested === "txt"
        ? formatConversationAsText(ctx.conversation, ctx.config)
        : requested === "json"
          ? formatConversationAsJson(ctx.conversation, ctx.config)
          : formatConversationAsHtml(ctx.conversation, ctx.config);

  try {
    writeFileSync(target, body);
    ctx.print(`Drexler export filed (${requested}): ${target}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.print(error(`Could not export: ${msg}`));
  }
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

function currentThemeName(config: Config): ThemeName {
  const activeTheme = getActiveTheme();
  const match = THEME_NAMES.find((name) => THEMES[name] === activeTheme);
  return match ?? config.theme ?? "apollo";
}

function currentStartupMode(config: Config): "fast" | "no-intro" | "normal" {
  if (config.fast === true) return "fast";
  if (config.noIntro === true) return "no-intro";
  return "normal";
}

function handleStartup(args: string[], ctx: CommandContext): CommandAction {
  if (args.length === 0) {
    ctx.print(`Current startup mode: ${currentStartupMode(ctx.config)}`);
    return { type: "continue" };
  }

  const requested = args[0]?.toLowerCase();
  if (requested === "fast") {
    ctx.config.fast = true;
    ctx.config.noIntro = true;
    ctx.print("Drexler save startup mode: fast.");
    return { type: "continue", persistConfig: { fast: true, noIntro: true } };
  }
  if (requested === "no-intro") {
    ctx.config.fast = false;
    ctx.config.noIntro = true;
    ctx.print("Drexler save startup mode: no-intro.");
    return { type: "continue", persistConfig: { fast: false, noIntro: true } };
  }
  if (requested === "normal") {
    ctx.config.fast = false;
    ctx.config.noIntro = false;
    ctx.print("Drexler restore full theatrical entrance.");
    return { type: "continue", persistConfig: { fast: false, noIntro: false } };
  }

  ctx.print(error(`Unknown startup mode: ${args[0]}. Use fast, no-intro, or normal.`));
  return { type: "continue" };
}

function handleTheme(args: string[], ctx: CommandContext): CommandAction {
  if (args.length === 0) {
    ctx.print(`Current theme: ${currentThemeName(ctx.config)}`);
    return { type: "continue" };
  }

  if (args[0]?.toLowerCase() === "save") {
    const current = currentThemeName(ctx.config);
    ctx.config.theme = current;
    ctx.print(`Drexler save boardroom decor: ${current}`);
    return { type: "continue", persistConfig: { theme: current } };
  }

  const requested = args[0]?.toLowerCase();
  if (!isThemeName(requested)) {
    ctx.print(
      error(
        `Unknown theme: "${args[0] ?? ""}". Use ${THEME_NAMES.join(", ")}.`,
      ),
    );
    return { type: "continue" };
  }

  ctx.config.theme = requested;
  setActiveTheme(requested);
  resetMarkedTheme();
  const shouldSave = args.slice(1).some((arg) => arg.toLowerCase() === "save");
  ctx.print(
    shouldSave
      ? `Drexler redecorate boardroom and save: ${requested}`
      : `Drexler redecorate boardroom: ${requested}`,
  );
  return shouldSave
    ? { type: "continue", persistConfig: { theme: requested } }
    : { type: "continue" };
}

function handleSetup(ctx: CommandContext): void {
  const envValid = isValidApiKey(process.env.OPENROUTER_API_KEY);
  const target = getResolvedConfigPath() ?? getConfigPath();
  const keySourceLabel = envValid
    ? "(env: OPENROUTER_API_KEY)"
    : isValidApiKey(ctx.config.apiKey)
      ? `(config file: ${target})`
      : "(missing — first-run prompt will request one)";

  const lines = [
    "Drexler setup ledger:",
    `  version       : ${getDrexlerVersion()}`,
    `  config file   : ${target}`,
    `  API key       : ${keySourceLabel}`,
    `  model         : ${ctx.config.model}`,
    `  theme         : ${currentThemeName(ctx.config)}`,
    `  startup mode  : ${currentStartupMode(ctx.config)}`,
    `  persona file  : ${ctx.config.personaPath}`,
  ];
  ctx.print(lines.join("\n"));
}

function handleUpdate(ctx: CommandContext): void {
  const lines = [
    `Drexler upgrade dossier (drexler v${getDrexlerVersion()}):`,
    "",
    "  bun update:    bun update -g drexler --latest",
    "  bun reinstall: bun install -g drexler@latest",
    "  npm:           npm install -g drexler@latest",
    "  pnpm:          pnpm add -g drexler@latest",
    "",
    "Drexler will not run installs. Type the command into your shell.",
  ];
  ctx.print(lines.join("\n"));
}
