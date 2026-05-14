import { afterEach, describe, expect, test } from "bun:test";
import {
  COMMAND_PALETTE,
  dispatch,
  filterPaletteByPrefix,
  isArgumentParentCommand,
  isSlash,
  parseSlash,
} from "../src/commands.ts";
import { Conversation } from "../src/conversation.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "../src/types.ts";
import type { Config } from "../src/types.ts";
import { getActiveTheme, setActiveTheme, THEMES } from "../src/ui/themes.ts";

afterEach(() => {
  setActiveTheme("apollo");
});

function makeCtx() {
  const conversation = new Conversation("SYS", 50);
  const config: Config = {
    apiKey: "k",
    model: MODEL_PRIMARY,
    maxHistory: 50,
    personaPath: "/tmp/p.md",
  };
  const out: string[] = [];
  return {
    ctx: { conversation, config, print: (s: string) => out.push(s) },
    out,
  };
}

describe("isSlash", () => {
  test("true for leading slash", () => {
    expect(isSlash("/help")).toBe(true);
  });
  test("false for plain text", () => {
    expect(isSlash("hello")).toBe(false);
  });
});

describe("parseSlash (V8 case-insensitive)", () => {
  test("lowercases command name", () => {
    expect(parseSlash("/HELP")).toEqual({ name: "help", args: [] });
  });
  test("splits args on whitespace", () => {
    expect(parseSlash("/model 26b")).toEqual({ name: "model", args: ["26b"] });
  });
});

describe("dispatch (V7, V8, V16, V17)", () => {
  test("/help prints help, returns continue", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/help", ctx);
    expect(action.type).toBe("continue");
    const printed = out.join("\n");
    expect(printed).toMatch(/Drexler permit following/);
    expect(printed).toContain("/search <term>");
    expect(printed).toContain("/export <fmt> [path]");
    expect(printed).toContain("/startup");
    expect(printed).toContain("/pet [on|off]");
    expect(printed).toContain("/redo");
    expect(printed).toContain("/retry [style]");
    expect(printed).toContain("/expand");
    expect(printed).toContain("/quote");
    expect(printed).toContain("/save-last [path]");
    expect(printed).toContain("/copy-last");
    expect(printed).toContain("/setup");
    expect(printed).toContain("/update");
  });

  test("/HELP works case-insensitive (V8)", () => {
    const { ctx, out } = makeCtx();
    dispatch("/HELP", ctx);
    expect(out.join("\n")).toMatch(/Drexler permit following/);
  });

  test("V16: /clear keeps system, drops history", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "a1");
    expect(ctx.conversation.length).toBe(2);
    dispatch("/clear", ctx);
    expect(ctx.conversation.length).toBe(0);
    expect(ctx.conversation.snapshot()[0]?.role).toBe("system");
  });

  test("/exit returns exit action with farewell", () => {
    const { ctx } = makeCtx();
    const action = dispatch("/exit", ctx);
    expect(action.type).toBe("exit");
    if (action.type === "exit") {
      expect(action.message).toMatch(/Drexler/);
    }
  });

  test("/synergy prints SYNERGY", () => {
    const { ctx, out } = makeCtx();
    dispatch("/synergy", ctx);
    expect(out.join("\n")).toMatch(/SYNERGY/);
  });

  test("pet directives are recognized outside the interactive UI", () => {
    for (const command of [
      "/feed",
      "/pet",
      "/play",
      "/work",
      "/praise",
      "/rest",
      "/vibe",
      "/name Bartholomew",
      "/profile",
    ]) {
      const { ctx, out } = makeCtx();
      const action = dispatch(command, ctx);
      expect(action.type).toBe("continue");
      expect(out.join("\n")).toContain("interactive deal desk");
    }
  });

  test("V17: /model <alias> switches active model", () => {
    const { ctx, out } = makeCtx();
    expect(ctx.config.model).toBe(MODEL_PRIMARY);
    dispatch("/model 26b", ctx);
    expect(ctx.config.model).toBe(MODEL_FALLBACK);
    expect(out.join("\n")).toMatch(/now consult model/);
  });

  test("/model with no arg shows current", () => {
    const { ctx, out } = makeCtx();
    dispatch("/model", ctx);
    expect(out.join("\n")).toContain(MODEL_PRIMARY);
  });

  test("/model bad value prints error, model unchanged", () => {
    const { ctx, out } = makeCtx();
    dispatch("/model garbage", ctx);
    expect(ctx.config.model).toBe(MODEL_PRIMARY);
    expect(out.join("\n")).toMatch(/Unknown model/);
  });

  test("/theme with no arg shows current runtime theme", () => {
    setActiveTheme("amber");
    const { ctx, out } = makeCtx();
    dispatch("/theme", ctx);
    expect(out.join("\n")).toContain("Current theme: amber");
  });

  test("/theme display prefers active runtime theme over config", () => {
    setActiveTheme("mono");
    const { ctx, out } = makeCtx();
    ctx.config.theme = "amber";
    dispatch("/theme", ctx);
    expect(out.join("\n")).toContain("Current theme: mono");
  });

  test("/theme <name> switches active theme and mutates config", () => {
    const { ctx, out } = makeCtx();
    dispatch("/theme midnight", ctx);
    expect(ctx.config.theme).toBe("midnight");
    expect(getActiveTheme()).toBe(THEMES.midnight);
    expect(out.join("\n")).toMatch(/redecorate boardroom: midnight/);
  });

  test("/theme <name> save returns persisted theme preference", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/theme plasma save", ctx);
    expect(ctx.config.theme).toBe("plasma");
    expect(out.join("\n")).toContain("save: plasma");
    expect(action.type).toBe("continue");
    if (action.type === "continue") {
      expect(action.persistConfig).toEqual({ theme: "plasma" });
    }
  });

  test("/theme save persists current runtime theme", () => {
    setActiveTheme("midnight");
    const { ctx } = makeCtx();
    const action = dispatch("/theme save", ctx);
    expect(action.type).toBe("continue");
    if (action.type === "continue") {
      expect(action.persistConfig).toEqual({ theme: "midnight" });
    }
  });

  test("/startup persists startup modes", () => {
    const { ctx, out } = makeCtx();
    const fast = dispatch("/startup fast", ctx);
    expect(ctx.config.fast).toBe(true);
    expect(ctx.config.noIntro).toBe(true);
    expect(fast.type).toBe("continue");
    if (fast.type === "continue") {
      expect(fast.persistConfig).toEqual({ fast: true, noIntro: true });
    }

    const normal = dispatch("/startup normal", ctx);
    expect(normal.type).toBe("continue");
    if (normal.type === "continue") {
      expect(normal.persistConfig).toEqual({ fast: false, noIntro: false });
    }
    expect(out.join("\n")).toContain("startup mode: fast");
    expect(out.join("\n")).toContain("full theatrical entrance");
  });

  test("/startup validates mode", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/startup neon", ctx);
    expect(action.type).toBe("continue");
    if (action.type === "continue") {
      expect(action.persistConfig).toBeUndefined();
    }
    expect(out.join("\n")).toContain("Unknown startup mode");
  });

  test("/theme is case-insensitive", () => {
    const { ctx } = makeCtx();
    dispatch("/theme AMBER", ctx);
    expect(ctx.config.theme).toBe("amber");
    expect(getActiveTheme()).toBe(THEMES.amber);
  });

  test("/theme bad value prints error and leaves theme unchanged", () => {
    const { ctx, out } = makeCtx();
    ctx.config.theme = "amber";
    setActiveTheme("amber");
    dispatch("/theme neon", ctx);
    expect(ctx.config.theme).toBe("amber");
    expect(getActiveTheme()).toBe(THEMES.amber);
    expect(out.join("\n")).toMatch(/Unknown theme/);
  });

  test("/history prints message count", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    dispatch("/history", ctx);
    expect(out.join("\n")).toMatch(/1 message/);
  });

  test("V8: unknown slash prints not-recognize line", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/foobar", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/not recognize/);
  });

  test("/regenerate with no prior message → continue", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/regenerate", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/need input first/);
  });

  test("/regenerate pops last assistant + returns regenerate action", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "hi");
    ctx.conversation.push("assistant", "old reply");
    const action = dispatch("/regenerate", ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.removedAssistant).toBe(true);
    }
    const snap = ctx.conversation.snapshot();
    expect(snap[snap.length - 1]?.role).toBe("user");
    expect(snap.some((m) => m.content === "old reply")).toBe(false);
  });

  test("/redo and /retry are aliases for regenerate", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "hi");
    ctx.conversation.push("assistant", "a");
    expect(dispatch("/redo", ctx).type).toBe("regenerate");
    ctx.conversation.push("assistant", "a2");
    expect(dispatch("/retry", ctx).type).toBe("regenerate");
  });

  test("/retry terse injects a hidden style instruction", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "hi");
    ctx.conversation.push("assistant", "a");
    const action = dispatch("/retry terse", ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.instruction).toContain("terse");
      expect(action.removedAssistant).toBe(true);
    }
    expect(out.join("\n")).toContain("Style mandate: terse");
    const last = ctx.conversation.snapshot().at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("hi");
  });

  test("/retry unknown style does not regenerate", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "hi");
    ctx.conversation.push("assistant", "a");
    const action = dispatch("/retry verbose", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toContain("Unknown retry style");
    expect(ctx.conversation.snapshot().at(-1)?.content).toBe("a");
  });

  test("/regenerate after assistant-less failed turn does not claim an assistant was removed", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "first");
    ctx.conversation.push("assistant", "first reply");
    ctx.conversation.push("user", "second");
    const action = dispatch("/regenerate", ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.removedAssistant).toBe(false);
    }
    expect(ctx.conversation.snapshot().map((m) => m.content)).toContain("first reply");
  });

  test("/expand and /quote print the latest assistant response", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "hi");
    ctx.conversation.push("assistant", "line one\nline two");
    dispatch("/expand", ctx);
    dispatch("/quote", ctx);
    const printed = out.join("\n");
    expect(printed).toContain("line one\nline two");
    expect(printed).toContain("> line one\n> line two");
  });

  test("/setup prints version, config path, key source, model, theme, startup, persona", () => {
    const { ctx, out } = makeCtx();
    const orig = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-padding1234567890";
    try {
      const action = dispatch("/setup", ctx);
      expect(action.type).toBe("continue");
      const printed = out.join("\n");
      expect(printed).toMatch(/Drexler setup ledger/);
      expect(printed).toContain("version");
      expect(printed).toContain("config file");
      expect(printed).toContain("API key");
      expect(printed).toContain("(env: OPENROUTER_API_KEY)");
      expect(printed).toContain(MODEL_PRIMARY);
      expect(printed).not.toContain("sk-or-test-padding1234567890");
    } finally {
      if (orig === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = orig;
    }
  });

  test("/setup reports startup mode 'fast' / 'no-intro' / 'normal'", () => {
    const { ctx, out } = makeCtx();
    ctx.config.fast = true;
    ctx.config.noIntro = true;
    dispatch("/setup", ctx);
    expect(out.join("\n")).toMatch(/startup mode\s*: fast/);

    out.length = 0;
    ctx.config.fast = false;
    ctx.config.noIntro = true;
    dispatch("/setup", ctx);
    expect(out.join("\n")).toMatch(/startup mode\s*: no-intro/);

    out.length = 0;
    ctx.config.fast = false;
    ctx.config.noIntro = false;
    dispatch("/setup", ctx);
    expect(out.join("\n")).toMatch(/startup mode\s*: normal/);
  });

  test("/update prints bun/npm/pnpm instructions and refuses to execute", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/update", ctx);
    expect(action.type).toBe("continue");
    const printed = out.join("\n");
    expect(printed).toContain("bun update -g drexler --latest");
    expect(printed).toContain("bun install -g drexler@latest");
    expect(printed).toContain("npm install -g drexler@latest");
    expect(printed).toContain("pnpm add -g drexler@latest");
    expect(printed).toMatch(/will not run installs/);
  });
});

describe("isArgumentParentCommand", () => {
  test("true for /theme, /model, /startup, /retry, /export", () => {
    for (const n of ["/theme", "/model", "/startup", "/retry", "/export"]) {
      expect(isArgumentParentCommand(n)).toBe(true);
    }
  });
  test("false for commands without chooser", () => {
    for (const n of [
      "/help",
      "/clear",
      "/exit",
      "/synergy",
      "/history",
      "/expand",
      "/quote",
      "/copy-last",
      "/setup",
      "/update",
    ]) {
      expect(isArgumentParentCommand(n)).toBe(false);
    }
  });
  test("false when arg already present", () => {
    expect(isArgumentParentCommand("/theme apollo")).toBe(false);
    expect(isArgumentParentCommand("/model 26b")).toBe(false);
  });
  test("case-insensitive", () => {
    expect(isArgumentParentCommand("/THEME")).toBe(true);
  });
  test("false for non-slash input", () => {
    expect(isArgumentParentCommand("theme")).toBe(false);
    expect(isArgumentParentCommand("")).toBe(false);
  });
});

describe("per-message actions", () => {
  test("/history prints numbered transcript with snippets", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "first question");
    ctx.conversation.push("assistant", "first reply");
    ctx.conversation.push("user", "second question");
    ctx.conversation.push("assistant", "second reply");
    dispatch("/history", ctx);
    const printed = out.join("\n");
    expect(printed).toContain("1. you: first question");
    expect(printed).toContain("2. drexler: first reply");
    expect(printed).toContain("3. you: second question");
    expect(printed).toContain("4. drexler: second reply");
  });

  test("/expand without arg prints last assistant", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "winning answer");
    dispatch("/expand", ctx);
    expect(out.join("\n")).toContain("winning answer");
  });

  test("/expand 2 prints the indexed assistant message", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "alpha");
    ctx.conversation.push("user", "u2");
    ctx.conversation.push("assistant", "bravo");
    dispatch("/expand 4", ctx);
    expect(out.join("\n")).toContain("bravo");
  });

  test("/expand on unknown index surfaces a helpful message", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "alpha");
    dispatch("/expand 99", ctx);
    expect(out.join("\n")).toMatch(/index 99/);
  });

  test("/quote 2 quotes the indexed assistant message", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "line one\nline two");
    dispatch("/quote 2", ctx);
    const printed = out.join("\n");
    expect(printed).toContain("> line one");
    expect(printed).toContain("> line two");
  });

  test("/edit 1 returns a draft action with the user message content", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "original prompt");
    ctx.conversation.push("assistant", "answer");
    const action = dispatch("/edit 1", ctx);
    expect(action.type).toBe("draft");
    if (action.type === "draft") {
      expect(action.value).toBe("original prompt");
    }
  });

  test("/edit without arg falls back to the last user message", () => {
    const { ctx } = makeCtx();
    ctx.conversation.push("user", "first");
    ctx.conversation.push("assistant", "answer1");
    ctx.conversation.push("user", "most recent");
    const action = dispatch("/edit", ctx);
    expect(action.type).toBe("draft");
    if (action.type === "draft") {
      expect(action.value).toBe("most recent");
    }
  });

  test("/edit refuses if the target is not a user message", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "u1");
    ctx.conversation.push("assistant", "a1");
    const action = dispatch("/edit 2", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/index 2/);
  });
});

describe("/save", () => {
  test("writes conversation to specified path", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-save-"));
    try {
      const target = join(dir, "out.md");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "hello");
      ctx.conversation.push("assistant", "Drexler reply");
      const action = dispatch(`/save ${target}`, ctx);
      expect(action.type).toBe("continue");
      const md = await readFile(target, "utf-8");
      expect(md).toContain("## You");
      expect(md).toContain("Model: ");
      expect(md).toContain("Theme: ");
      expect(md).toContain("hello");
      expect(md).toContain("## Drexler");
      expect(md).toContain("Drexler reply");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses to overwrite existing file", async () => {
    const { mkdtemp, rm, writeFile, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-save-"));
    try {
      const target = join(dir, "exists.md");
      await writeFile(target, "ORIGINAL", "utf-8");
      const { ctx, out } = makeCtx();
      ctx.conversation.push("user", "x");
      const action = dispatch(`/save ${target}`, ctx);
      expect(action.type).toBe("continue");
      expect(out.join("\n")).toMatch(/Refuse to overwrite/i);
      const after = await readFile(target, "utf-8");
      expect(after).toBe("ORIGINAL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes to path containing spaces", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-save-"));
    try {
      const target = join(dir, "my chat archive.md");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "space path");
      const action = dispatch(`/save "${target}"`, ctx);
      expect(action.type).toBe("continue");
      const md = await readFile(target, "utf-8");
      expect(md).toContain("space path");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path containing '..' segment (relative)", async () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "x");
    const action = dispatch("/save subdir/../escape.md", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/no '\.\.' segments allowed/);
  });

  test("rejects path containing '..' segment (absolute)", async () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "x");
    const action = dispatch("/save /etc/../escape.md", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/no '\.\.' segments allowed/);
  });

  test("rejects backslash '..' segment (Windows-style traversal)", async () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "x");
    const action = dispatch("/save sub\\..\\escape.md", ctx);
    expect(action.type).toBe("continue");
    expect(out.join("\n")).toMatch(/no '\.\.' segments allowed/);
  });

  test("rejects non-.md target extension", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-save-"));
    try {
      const target = join(dir, "leak.txt");
      const { ctx, out } = makeCtx();
      ctx.conversation.push("user", "x");
      const action = dispatch(`/save ${target}`, ctx);
      expect(action.type).toBe("continue");
      expect(out.join("\n")).toMatch(/must end in \.md/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allows '..' inside filename (not as segment)", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-save-"));
    try {
      const target = join(dir, "weird..name.md");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "x");
      const action = dispatch(`/save ${target}`, ctx);
      expect(action.type).toBe("continue");
      const md = await readFile(target, "utf-8");
      expect(md).toContain("x");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("with no args, writes to drexler-<timestamp>.md in cwd", async () => {
    const { rm, readFile } = await import("node:fs/promises");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-cwd-"));
    const origCwd = process.cwd();
    try {
      process.chdir(dir);
      const { ctx, out } = makeCtx();
      ctx.conversation.push("user", "u");
      const action = dispatch("/save", ctx);
      expect(action.type).toBe("continue");
      const printed = out.join("\n");
      const m = printed.match(/sealed: (.+\.md)/);
      expect(m).not.toBeNull();
      const md = await readFile(m![1]!, "utf-8");
      expect(md).toContain("u");
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("search, export, and last-response commands", () => {
  test("/search finds matching transcript rows", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("user", "Review covenant headroom");
    ctx.conversation.push("assistant", "Covenant headroom looks acceptable.");
    dispatch("/search covenant", ctx);
    const printed = out.join("\n");
    expect(printed).toContain('Search results for "covenant": 2');
    expect(printed).toContain("You:");
    expect(printed).toContain("Drexler:");
  });

  test("/search handles missing and unmatched terms", () => {
    const { ctx, out } = makeCtx();
    dispatch("/search", ctx);
    dispatch("/search leverage", ctx);
    const printed = out.join("\n");
    expect(printed).toMatch(/Usage: \/search <term>/);
    expect(printed).toContain('No transcript matches for "leverage".');
  });

  test("/export md writes markdown", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-export-"));
    try {
      const target = join(dir, "memo.md");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "markdown export");
      const action = dispatch(`/export md ${target}`, ctx);
      expect(action.type).toBe("continue");
      const md = await readFile(target, "utf-8");
      expect(md).toContain("# Drexler Conversation");
      expect(md).toContain("markdown export");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/export txt writes plain text", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-export-"));
    try {
      const target = join(dir, "memo.txt");
      const { ctx } = makeCtx();
      ctx.conversation.push("assistant", "plain export");
      const action = dispatch(`/export txt ${target}`, ctx);
      expect(action.type).toBe("continue");
      const txt = await readFile(target, "utf-8");
      expect(txt).toContain("Drexler Conversation");
      expect(txt).toContain("[Drexler]");
      expect(txt).toContain("plain export");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/export json writes metadata and messages", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-export-"));
    try {
      const target = join(dir, "memo.json");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "json export");
      const action = dispatch(`/export json ${target}`, ctx);
      expect(action.type).toBe("continue");
      const parsed = JSON.parse(await readFile(target, "utf-8"));
      expect(parsed.messageCount).toBe(1);
      expect(parsed.model).toBe(MODEL_PRIMARY);
      expect(parsed.theme).toBe("apollo");
      expect(parsed.messages).toEqual([{ role: "user", content: "json export" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/export html escapes transcript content", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-export-"));
    try {
      const target = join(dir, "memo.html");
      const { ctx } = makeCtx();
      ctx.conversation.push("user", "<script>alert(1)</script>");
      const action = dispatch(`/export html ${target}`, ctx);
      expect(action.type).toBe("continue");
      const html = await readFile(target, "utf-8");
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("<header>");
      expect(html).toContain("Model ");
      expect(html).toContain("@media print");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>alert(1)</script>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/export validates format, extension, traversal, and overwrite", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-export-"));
    try {
      const target = join(dir, "exists.json");
      await writeFile(target, "ORIGINAL", "utf-8");
      const { ctx, out } = makeCtx();
      dispatch("/export pdf out.pdf", ctx);
      dispatch(`/export json ${join(dir, "wrong.txt")}`, ctx);
      dispatch("/export md subdir/../escape.md", ctx);
      dispatch(`/export json ${target}`, ctx);
      const printed = out.join("\n");
      expect(printed).toMatch(/Usage: \/export md\|txt\|json\|html/);
      expect(printed).toMatch(/Target must end in \.json/);
      expect(printed).toMatch(/no '\.\.' segments allowed/);
      expect(printed).toMatch(/Refuse to overwrite/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/save-last writes only the last assistant response", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "drexler-last-"));
    try {
      const target = join(dir, "last.md");
      const { ctx } = makeCtx();
      ctx.conversation.push("assistant", "first reply");
      ctx.conversation.push("user", "new question");
      ctx.conversation.push("assistant", "final reply");
      const action = dispatch(`/save-last ${target}`, ctx);
      expect(action.type).toBe("continue");
      const md = await readFile(target, "utf-8");
      expect(md).toContain("# Drexler Last Response");
      expect(md).toContain("final reply");
      expect(md).not.toContain("first reply");
      expect(md).not.toContain("new question");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/save-last reports when no assistant response exists", () => {
    const { ctx, out } = makeCtx();
    dispatch("/save-last", ctx);
    expect(out.join("\n")).toMatch(/not issued a response/);
  });

  test("/copy-last copies latest assistant response through injected writer", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("assistant", "clipboard reply");
    let copied = "";
    dispatch("/copy-last", {
      ...ctx,
      copyToClipboard: (text: string) => {
        copied = text;
        return { ok: true, command: "test-clipboard" } as const;
      },
    });
    expect(copied).toBe("clipboard reply");
    expect(out.join("\n")).toContain("copied last response to clipboard");
    expect(out.join("\n")).toContain("test-clipboard");
  });

  test("/copy-last gives save fallback when clipboard is unavailable", () => {
    const { ctx, out } = makeCtx();
    ctx.conversation.push("assistant", "clipboard reply");
    dispatch("/copy-last", {
      ...ctx,
      copyToClipboard: () => ({ ok: false, reason: "no clipboard utility found" }) as const,
    });
    expect(out.join("\n")).toContain("Clipboard unavailable");
    expect(out.join("\n")).toContain("/save-last");
  });

  test("/copy-last reports when no assistant response exists", () => {
    const { ctx, out } = makeCtx();
    dispatch("/copy-last", {
      ...ctx,
      copyToClipboard: () => {
        throw new Error("should not be called");
      },
    });
    expect(out.join("\n")).toMatch(/not issued a response/);
  });
});

describe("filterPaletteByPrefix", () => {
  test("empty input returns no items (palette closed)", () => {
    expect(filterPaletteByPrefix("")).toEqual([]);
  });

  test("non-slash input returns no items", () => {
    expect(filterPaletteByPrefix("hello")).toEqual([]);
  });

  test("just '/' returns all commands", () => {
    expect(filterPaletteByPrefix("/")).toEqual(COMMAND_PALETTE);
  });

  test("prefix narrows results", () => {
    const out = filterPaletteByPrefix("/h");
    expect(out.map((c) => c.name)).toEqual(["/help", "/history"]);
  });

  test("theme command appears in palette", () => {
    const out = filterPaletteByPrefix("/t");
    expect(out.map((c) => c.name)).toEqual(["/trade", "/theme"]);
  });

  test("exact constrained commands open their argument chooser smoothly", () => {
    const out = filterPaletteByPrefix("/theme");
    expect(out.map((c) => c.name).slice(0, 4)).toEqual([
      "/theme",
      "/theme apollo",
      "/theme amber",
      "/theme mono",
    ]);
    expect(out[0]).toEqual({
      name: "/theme",
      description: "Theme chooser",
      hint: "select a look below",
    });
  });

  test("exact overlapping prefix keeps related longer commands visible", () => {
    const out = filterPaletteByPrefix("/save");
    expect(out.map((c) => c.name)).toEqual(["/save", "/save-last"]);
  });

  test("redo command appears in palette", () => {
    const out = filterPaletteByPrefix("/re");
    expect(out.map((c) => c.name)).toEqual([
      "/rest",
      "/respond",
      "/review",
      "/regenerate",
      "/redo",
      "/retry",
    ]);
  });

  test("pet command appears in palette", () => {
    const out = filterPaletteByPrefix("/pe");
    expect(out).toMatchObject([{ name: "/pet", description: "Toggle pet dashboard mode" }]);
  });

  test("save-last command appears after overlapping prefix", () => {
    const out = filterPaletteByPrefix("/save-");
    expect(out).toMatchObject([{ name: "/save-last", description: "Save last Drexler response" }]);
  });

  test("/copy prefix surfaces both /copy and /copy-last", () => {
    const out = filterPaletteByPrefix("/copy");
    expect(out.map((c) => c.name)).toEqual(["/copy", "/copy-last"]);
  });

  test("known commands with constrained args show argument suggestions", () => {
    expect(filterPaletteByPrefix("/theme ").map((c) => c.name)).toContain("/theme midnight");
    expect(filterPaletteByPrefix("/theme ").find((c) => c.name === "/theme midnight")).toEqual({
      name: "/theme midnight",
      description: "Cool blue night desk",
      hint: "focused late-session work",
    });
    expect(filterPaletteByPrefix("/theme m").map((c) => c.name)).toEqual([
      "/theme mono",
      "/theme midnight",
    ]);
    expect(filterPaletteByPrefix("/startup ").map((c) => c.name)).toEqual([
      "/startup fast",
      "/startup no-intro",
      "/startup normal",
    ]);
    expect(filterPaletteByPrefix("/retry b").map((c) => c.name)).toEqual(["/retry brutal"]);
    expect(filterPaletteByPrefix("/export j").map((c) => c.name)).toEqual(["/export json"]);
    expect(filterPaletteByPrefix("/model 2").map((c) => c.name)).toEqual(["/model 26b"]);
  });

  test("free-form commands with args close palette", () => {
    expect(filterPaletteByPrefix("/save ")).toEqual([]);
    expect(filterPaletteByPrefix("/search covenant")).toEqual([]);
  });

  test("case-insensitive prefix match", () => {
    expect(filterPaletteByPrefix("/HE").map((c) => c.name)).toEqual(["/help"]);
  });

  test("no-match prefix returns empty", () => {
    expect(filterPaletteByPrefix("/zzz")).toEqual([]);
  });

  test("uppercase argument-parent command still opens the chooser", () => {
    const rows = filterPaletteByPrefix("/THEME");
    expect(rows[0]?.name).toBe("/theme");
    expect(rows.some((r) => r.name === "/theme apollo")).toBe(true);
  });

  test("uppercase argument suggestion prefix filters the values", () => {
    const rows = filterPaletteByPrefix("/THEME ");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.name.startsWith("/theme "))).toBe(true);
  });

  test("partial argument prefix narrows suggestions", () => {
    const rows = filterPaletteByPrefix("/theme mid");
    expect(rows.map((r) => r.name)).toContain("/theme midnight");
    expect(rows.every((r) => r.name.startsWith("/theme mid"))).toBe(true);
  });
});

describe("/model multi-turn switching", () => {
  test("switches model and persists across subsequent dispatches", () => {
    const { ctx } = makeCtx();
    expect(ctx.config.model).toBe(MODEL_PRIMARY);
    dispatch("/model 26b", ctx);
    expect(ctx.config.model).toBe(MODEL_FALLBACK);
    // Subsequent /history sees the new model in same ctx
    dispatch("/history", ctx);
    // Switch back
    dispatch("/model 31b", ctx);
    expect(ctx.config.model).toBe(MODEL_PRIMARY);
  });

  test("switching to bad value after good value leaves prior model intact", () => {
    const { ctx } = makeCtx();
    dispatch("/model 26b", ctx);
    expect(ctx.config.model).toBe(MODEL_FALLBACK);
    dispatch("/model garbage", ctx);
    expect(ctx.config.model).toBe(MODEL_FALLBACK);
  });
});

describe("/debug (§T13, V39)", () => {
  test("dispatches to { type: 'debug' } action", () => {
    const { ctx, out } = makeCtx();
    const action = dispatch("/debug", ctx);
    expect(action.type).toBe("debug");
    // /debug itself prints nothing — the App handler reads telemetry
    // and renders it; dispatch just returns the action.
    expect(out).toEqual([]);
  });

  test("/DEBUG is case-insensitive (V8)", () => {
    const { ctx } = makeCtx();
    const action = dispatch("/DEBUG", ctx);
    expect(action.type).toBe("debug");
  });

  test("/debug appears in /help text", () => {
    const { ctx, out } = makeCtx();
    dispatch("/help", ctx);
    expect(out.join("\n")).toContain("/debug");
  });

  test("/debug appears in command palette", () => {
    expect(COMMAND_PALETTE.some((c) => c.name === "/debug")).toBe(true);
  });
});
