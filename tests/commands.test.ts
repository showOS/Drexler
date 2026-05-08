import { describe, expect, test } from "bun:test";
import { dispatch, isSlash, parseSlash } from "../src/commands.ts";
import { Conversation } from "../src/conversation.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "../src/types.ts";
import type { Config } from "../src/types.ts";

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
    expect(out.join("\n")).toMatch(/Drexler permit following/);
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
