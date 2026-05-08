import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultPersonaPath,
  ensureApiKey,
  isValidApiKey,
  loadConfigFile,
  parseFlags,
  resolveConfig,
  resolveModel,
  saveConfig,
} from "../src/config.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "../src/types.ts";

describe("parseFlags", () => {
  test("parses --model alias (space form)", () => {
    expect(parseFlags(["--model", "26b"])).toEqual({ model: "26b" });
  });

  test("parses --model=value", () => {
    expect(parseFlags(["--model=31b"])).toEqual({ model: "31b" });
  });

  test("parses --persona path", () => {
    expect(parseFlags(["--persona", "/tmp/x.md"])).toEqual({
      persona: "/tmp/x.md",
    });
  });

  test("parses both flags together", () => {
    expect(parseFlags(["--model", "26b", "--persona=/p/x.md"])).toEqual({
      model: "26b",
      persona: "/p/x.md",
    });
  });

  test("ignores unknown flags", () => {
    expect(parseFlags(["--unknown", "x"])).toEqual({});
  });

  test("parses --theme alias (space form)", () => {
    expect(parseFlags(["--theme", "amber"])).toEqual({ theme: "amber" });
  });

  test("parses --theme=value", () => {
    expect(parseFlags(["--theme=mono"])).toEqual({ theme: "mono" });
  });
});

describe("resolveModel", () => {
  test("alias 31b → primary", () => {
    expect(resolveModel("31b")).toBe(MODEL_PRIMARY);
  });

  test("alias 26b → fallback", () => {
    expect(resolveModel("26b")).toBe(MODEL_FALLBACK);
  });

  test("vendor/name:tag passes through", () => {
    expect(resolveModel("google/gemma-4-31b-it:free")).toBe(
      "google/gemma-4-31b-it:free",
    );
  });

  test("vendor/name without tag passes", () => {
    expect(resolveModel("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  test("unknown shape throws (V12)", () => {
    expect(() => resolveModel("just-a-name")).toThrow(/Unknown model/);
  });

  test("empty string throws", () => {
    expect(() => resolveModel("")).toThrow(/Unknown model/);
  });
});

describe("defaultPersonaPath", () => {
  test("ends with prompts/drexler.md", () => {
    expect(defaultPersonaPath()).toMatch(/prompts\/drexler\.md$/);
  });

  test("is absolute", () => {
    expect(defaultPersonaPath().startsWith("/")).toBe(true);
  });
});

describe("isValidApiKey", () => {
  test("rejects undefined and null", () => {
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey(null)).toBe(false);
  });

  test("rejects non-string", () => {
    expect(isValidApiKey(123 as never)).toBe(false);
  });

  test("rejects empty and whitespace-only", () => {
    expect(isValidApiKey("")).toBe(false);
    expect(isValidApiKey("   ")).toBe(false);
    expect(isValidApiKey("\t\n")).toBe(false);
  });

  test("rejects placeholder 'sk-or-your-key-here'", () => {
    expect(isValidApiKey("sk-or-your-key-here")).toBe(false);
    expect(isValidApiKey("Your-Key-Here")).toBe(false);
  });

  test("rejects literal stub/test/todo placeholders", () => {
    expect(isValidApiKey("stub")).toBe(false);
    expect(isValidApiKey("test")).toBe(false);
    expect(isValidApiKey("TODO")).toBe(false);
  });

  test("rejects sk-or-v1-... ellipsis placeholder", () => {
    expect(isValidApiKey("sk-or-v1-...")).toBe(false);
  });

  test("accepts realistic-looking keys", () => {
    expect(isValidApiKey("sk-or-realtest123abcdef")).toBe(true);
    expect(isValidApiKey("sk-or-v1-abc123def456")).toBe(true);
  });

  test("rejects keys shorter than 20 chars (catches leftover sandbox stubs)", () => {
    expect(isValidApiKey("sk-or-key")).toBe(false);
    expect(isValidApiKey("sk-or-test1")).toBe(false);
    expect(isValidApiKey("sk-or-19chars-pad12")).toBe(false); // 19
    expect(isValidApiKey("sk-or-20chars-pad123")).toBe(true); // 20
  });
});

describe("XDG_CONFIG_HOME respected", () => {
  let origHome: string | undefined;
  let origXdg: string | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "drexler-xdg-"));
    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = dir;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    if (origXdg !== undefined) process.env.XDG_CONFIG_HOME = origXdg;
    else delete process.env.XDG_CONFIG_HOME;
    await rm(dir, { recursive: true, force: true });
  });

  test("saveConfig writes under XDG_CONFIG_HOME/drexler when set", async () => {
    const xdg = join(dir, "custom-xdg");
    await mkdir(xdg, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    await saveConfig({ apiKey: "sk-or-xdg-padding1234567890" });
    const xdgConfigPath = join(xdg, "drexler", "config.json");
    const { stat } = await import("node:fs/promises");
    const s = await stat(xdgConfigPath);
    expect(s.isFile()).toBe(true);
  });

  test("falls back to ~/.config/drexler when XDG_CONFIG_HOME unset", async () => {
    delete process.env.XDG_CONFIG_HOME;
    await saveConfig({ apiKey: "sk-or-default-padding12345" });
    const standardPath = join(dir, ".config", "drexler", "config.json");
    const { stat } = await import("node:fs/promises");
    const s = await stat(standardPath);
    expect(s.isFile()).toBe(true);
  });

  test("falls back to ~/.config/drexler when XDG_CONFIG_HOME is empty/whitespace", async () => {
    process.env.XDG_CONFIG_HOME = "   ";
    await saveConfig({ apiKey: "sk-or-empty-xdg-padding123" });
    const standardPath = join(dir, ".config", "drexler", "config.json");
    const { stat } = await import("node:fs/promises");
    const s = await stat(standardPath);
    expect(s.isFile()).toBe(true);
  });
});

describe("loadConfigFile / saveConfig", () => {
  let origHome: string | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "drexler-cfg-"));
    origHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    await rm(dir, { recursive: true, force: true });
  });

  test("loadConfigFile returns empty when no config exists", async () => {
    expect(await loadConfigFile()).toEqual({});
  });

  test("loadConfigFile reads ~/.config/drexler/config.json", async () => {
    const cfgDir = join(dir, ".config", "drexler");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "config.json"),
      JSON.stringify({ apiKey: "sk-or-test1-padding1234567890", model: "26b" }),
    );
    const cfg = await loadConfigFile();
    expect(cfg.apiKey).toBe("sk-or-test1-padding1234567890");
    expect(cfg.model).toBe("26b");
  });

  test("loadConfigFile falls back to legacy ~/.drexlerrc", async () => {
    await writeFile(
      join(dir, ".drexlerrc"),
      JSON.stringify({ apiKey: "sk-or-legacy-padding1234567890" }),
    );
    const cfg = await loadConfigFile();
    expect(cfg.apiKey).toBe("sk-or-legacy-padding1234567890");
  });

  test("loadConfigFile prefers new path over legacy", async () => {
    const cfgDir = join(dir, ".config", "drexler");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "config.json"),
      JSON.stringify({ apiKey: "sk-or-new-padding1234567890ab" }),
    );
    await writeFile(
      join(dir, ".drexlerrc"),
      JSON.stringify({ apiKey: "sk-or-legacy-padding1234567890" }),
    );
    expect((await loadConfigFile()).apiKey).toBe("sk-or-new-padding1234567890ab");
  });

  test("loadConfigFile returns empty on malformed JSON", async () => {
    const cfgDir = join(dir, ".config", "drexler");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(join(cfgDir, "config.json"), "{ broken json");
    expect(await loadConfigFile()).toEqual({});
  });

  test("saveConfig writes config and merges with existing", async () => {
    await saveConfig({ apiKey: "sk-or-1-padding1234567890abcd", model: "31b" });
    let cfg = await loadConfigFile();
    expect(cfg.apiKey).toBe("sk-or-1-padding1234567890abcd");
    expect(cfg.model).toBe("31b");

    await saveConfig({ model: "26b" });
    cfg = await loadConfigFile();
    expect(cfg.apiKey).toBe("sk-or-1-padding1234567890abcd");
    expect(cfg.model).toBe("26b");
  });

  test("saveConfig writes file with mode 0600", async () => {
    await saveConfig({ apiKey: "sk-or-secret-padding1234567890" });
    const cfgPath = join(dir, ".config", "drexler", "config.json");
    const { stat } = await import("node:fs/promises");
    const s = await stat(cfgPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  test("saveConfig file is valid JSON round-trip", async () => {
    await saveConfig({ apiKey: "sk-or-rt-padding1234567890ab", maxHistory: 25 });
    const raw = await readFile(
      join(dir, ".config", "drexler", "config.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.apiKey).toBe("sk-or-rt-padding1234567890ab");
    expect(parsed.maxHistory).toBe(25);
  });
});

describe("ensureApiKey + resolveConfig (no-prompt paths)", () => {
  let origHome: string | undefined;
  let origEnvKey: string | undefined;
  let origEnvModel: string | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "drexler-ek-"));
    origHome = process.env.HOME;
    origEnvKey = process.env.OPENROUTER_API_KEY;
    origEnvModel = process.env.DREXLER_MODEL;
    process.env.HOME = dir;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DREXLER_MODEL;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    if (origEnvKey !== undefined)
      process.env.OPENROUTER_API_KEY = origEnvKey;
    else delete process.env.OPENROUTER_API_KEY;
    if (origEnvModel !== undefined) process.env.DREXLER_MODEL = origEnvModel;
    else delete process.env.DREXLER_MODEL;
    await rm(dir, { recursive: true, force: true });
  });

  test("ensureApiKey returns env key when set and valid", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-fromenv1234-padding12345";
    expect(await ensureApiKey()).toBe("sk-or-fromenv1234-padding12345");
  });

  test("ensureApiKey trims env key", async () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-trimme-padding1234567890  ";
    expect(await ensureApiKey()).toBe("sk-or-trimme-padding1234567890");
  });

  test("ensureApiKey treats placeholder env key as missing → falls back to config file", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-your-key-here";
    await saveConfig({ apiKey: "sk-or-fromfile-padding1234567890" });
    expect(await ensureApiKey()).toBe("sk-or-fromfile-padding1234567890");
  });

  test("ensureApiKey returns config file key when env missing", async () => {
    await saveConfig({ apiKey: "sk-or-fileonly-padding1234567890" });
    expect(await ensureApiKey()).toBe("sk-or-fileonly-padding1234567890");
  });

  test("resolveConfig prefers env key over file key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-envkey-padding1234567890";
    await saveConfig({ apiKey: "sk-or-filekey-padding1234567890" });
    const cfg = await resolveConfig([]);
    expect(cfg.apiKey).toBe("sk-or-envkey-padding1234567890");
  });

  test("resolveConfig --model flag overrides env DREXLER_MODEL", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    process.env.DREXLER_MODEL = "31b";
    const cfg = await resolveConfig(["--model", "26b"]);
    expect(cfg.model).toBe(MODEL_FALLBACK);
  });

  test("resolveConfig env DREXLER_MODEL overrides file model", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    process.env.DREXLER_MODEL = "26b";
    await saveConfig({ apiKey: "sk-or-key-padding1234567890ab", model: "31b" });
    const cfg = await resolveConfig([]);
    expect(cfg.model).toBe(MODEL_FALLBACK);
  });

  test("resolveConfig file model used when no flag/env", async () => {
    await saveConfig({ apiKey: "sk-or-filekey-padding1234567890", model: "26b" });
    const cfg = await resolveConfig([]);
    expect(cfg.model).toBe(MODEL_FALLBACK);
  });

  test("resolveConfig defaults model to 31b primary", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const cfg = await resolveConfig([]);
    expect(cfg.model).toBe(MODEL_PRIMARY);
  });

  test("resolveConfig --persona overrides default path", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const cfg = await resolveConfig(["--persona", "/custom/path.md"]);
    expect(cfg.personaPath).toBe("/custom/path.md");
  });

  test("resolveConfig file maxHistory respected if positive number", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    await saveConfig({ apiKey: "sk-or-key-padding1234567890ab", maxHistory: 25 });
    const cfg = await resolveConfig([]);
    expect(cfg.maxHistory).toBe(25);
  });

  test("resolveConfig defaults maxHistory to 50 when missing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const cfg = await resolveConfig([]);
    expect(cfg.maxHistory).toBe(50);
  });

  test("resolveConfig throws when no API key anywhere", async () => {
    await expect(resolveConfig([])).rejects.toThrow(/API key missing/);
  });

  test("resolveConfig invalid model alias rejects", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    expect(() => resolveConfig(["--model", "garbage"])).toThrow(
      /Unknown model/,
    );
  });

  test("resolveConfig --theme flag wins over env DREXLER_THEME", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const origTheme = process.env.DREXLER_THEME;
    process.env.DREXLER_THEME = "mono";
    try {
      const cfg = await resolveConfig(["--theme", "amber"]);
      expect(cfg.theme).toBe("amber");
    } finally {
      if (origTheme !== undefined) process.env.DREXLER_THEME = origTheme;
      else delete process.env.DREXLER_THEME;
    }
  });

  test("resolveConfig env DREXLER_THEME used when no flag", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const origTheme = process.env.DREXLER_THEME;
    process.env.DREXLER_THEME = "mono";
    try {
      const cfg = await resolveConfig([]);
      expect(cfg.theme).toBe("mono");
    } finally {
      if (origTheme !== undefined) process.env.DREXLER_THEME = origTheme;
      else delete process.env.DREXLER_THEME;
    }
  });

  test("resolveConfig invalid theme value is ignored (theme undefined)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-key-padding1234567890ab";
    const cfg = await resolveConfig(["--theme", "neon"]);
    expect(cfg.theme).toBeUndefined();
  });
});
