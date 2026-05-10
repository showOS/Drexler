import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import type { CliFlags, Config, ThemeName } from "./types.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, THEME_NAMES } from "./types.ts";

const DEFAULT_MAX_HISTORY = 50;

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}
function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg && xdg.length > 0) return join(xdg, "drexler");
  return join(getHome(), ".config", "drexler");
}
function configPath(): string {
  return join(configDir(), "config.json");
}
function legacyConfigPath(): string {
  return join(getHome(), ".drexlerrc");
}

const MODEL_ID_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+(?::[a-z0-9]+)?$/i;

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  const valueAfter = (i: number): string | undefined => {
    const value = argv[i + 1];
    return value !== undefined && !value.startsWith("--") ? value : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" && valueAfter(i) !== undefined) {
      flags.model = argv[++i];
    } else if (a === "--persona" && valueAfter(i) !== undefined) {
      flags.persona = argv[++i];
    } else if (a === "--theme" && valueAfter(i) !== undefined) {
      flags.theme = argv[++i];
    } else if (a === "--no-intro") {
      flags.noIntro = true;
    } else if (a === "--fast") {
      flags.fast = true;
    } else if (a !== undefined && a.startsWith("--model=")) {
      flags.model = a.slice("--model=".length);
    } else if (a !== undefined && a.startsWith("--persona=")) {
      flags.persona = a.slice("--persona=".length);
    } else if (a !== undefined && a.startsWith("--theme=")) {
      flags.theme = a.slice("--theme=".length);
    }
  }
  return flags;
}

export function resolveModel(input: string): string {
  if (input === "31b") return MODEL_PRIMARY;
  if (input === "26b") return MODEL_FALLBACK;
  if (MODEL_ID_PATTERN.test(input)) return input;
  throw new Error(
    `Unknown model: "${input}". Use 31b, 26b, or full id like google/gemma-4-31b-it.`,
  );
}

export function defaultPersonaPath(): string {
  return resolve(import.meta.dir, "..", "prompts", "drexler.md");
}

export async function loadConfigFile(): Promise<Partial<Config>> {
  const cp = configPath();
  const lp = legacyConfigPath();
  const path = existsSync(cp) ? cp : existsSync(lp) ? lp : null;
  if (!path) return {};
  try {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(
        `Drexler config at ${path} is not a JSON object; ignoring (defaults applied).`,
      );
      return {};
    }
    return parsed as Partial<Config>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `Drexler config at ${path} could not be read (${msg}); ignoring (defaults applied).`,
    );
    return {};
  }
}

export async function saveConfig(partial: Partial<Config>): Promise<void> {
  // Known limitation: concurrent drexler instances racing on saveConfig can
  // lose one side's merge (read-modify-write TOCTOU). Acceptable for
  // single-user CLI; revisit with proper-lockfile if write frequency grows.
  const existing = await loadConfigFile();
  const merged = { ...existing, ...partial };
  const dir = configDir();
  const target = configPath();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Atomic write: temp file + rename, mode 0600 (config holds API key).
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(merged, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  try {
    await chmod(target, 0o600);
  } catch {}
}

const PLACEHOLDER_RE = /your-key-here|sk-or-v1-\.\.\.|^(stub|test|todo)$/i;
const MIN_KEY_LEN = 20;

export function isValidApiKey(k: string | undefined | null): k is string {
  if (typeof k !== "string") return false;
  const t = k.trim();
  if (t.length < MIN_KEY_LEN) return false;
  if (PLACEHOLDER_RE.test(t)) return false;
  return true;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

async function readApiKeyFromStdin(): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const ans = await rl.question("Enter OpenRouter API key: ");
    const trimmed = ans.trim();
    return trimmed.length > 0 ? trimmed : null;
  } finally {
    rl.close();
  }
}

export async function ensureApiKey(opts?: {
  prompt?: () => Promise<string | null>;
}): Promise<string> {
  const fileCfg = await loadConfigFile();
  const envKey = process.env.OPENROUTER_API_KEY;
  if (isValidApiKey(envKey)) return envKey.trim();
  if (isValidApiKey(fileCfg.apiKey)) return fileCfg.apiKey.trim();

  if (!opts?.prompt) {
    console.log("Drexler notice no API key on file. Even CEO need credentials.");
    console.log("Get free key at: https://openrouter.ai/keys");
  }

  const entered = await (opts?.prompt ?? readApiKeyFromStdin)();
  if (!isValidApiKey(entered)) {
    console.error("No valid API key provided. Drexler refuse to work pro bono.");
    process.exit(1);
  }
  const apiKey = entered.trim();
  await saveConfig({ apiKey });
  return apiKey;
}

export async function resolveConfig(argv: string[]): Promise<Config> {
  const flags = parseFlags(argv);
  const fileCfg = await loadConfigFile();
  const envKey = process.env.OPENROUTER_API_KEY;
  const envModel = process.env.DREXLER_MODEL;

  const apiKey = isValidApiKey(envKey)
    ? envKey.trim()
    : isValidApiKey(fileCfg.apiKey)
    ? fileCfg.apiKey.trim()
    : "";

  if (!apiKey) {
    throw new Error(
      "API key missing. Run drexler interactively to set one, or export OPENROUTER_API_KEY.",
    );
  }

  const modelInput = flags.model ?? envModel ?? fileCfg.model ?? "31b";
  const model = resolveModel(modelInput);

  let personaPath: string;
  if (flags.persona) {
    const resolved = resolve(flags.persona);
    // lstat (not stat) so symlinks pointing to non-.md targets cannot bypass
    // the extension check via `ln -s /etc/passwd evil.md`.
    const st = await lstat(resolved).catch(() => null);
    if (!st?.isFile() || !resolved.toLowerCase().endsWith(".md")) {
      throw new Error(
        `Invalid --persona: ${flags.persona} (must be a regular .md file; symlinks rejected).`,
      );
    }
    personaPath = resolved;
  } else {
    personaPath = fileCfg.personaPath ?? defaultPersonaPath();
  }

  const maxHistory =
    typeof fileCfg.maxHistory === "number" &&
    Number.isInteger(fileCfg.maxHistory) &&
    fileCfg.maxHistory >= 3
      ? fileCfg.maxHistory
      : DEFAULT_MAX_HISTORY;

  const themeCandidate =
    flags.theme ?? process.env.DREXLER_THEME ?? fileCfg.theme;
  const theme =
    typeof themeCandidate === "string" &&
    THEME_NAMES.includes(themeCandidate as ThemeName)
      ? (themeCandidate as ThemeName)
      : undefined;

  const noIntro =
    flags.noIntro ??
    parseOptionalBoolean(process.env.DREXLER_NO_INTRO) ??
    parseOptionalBoolean(fileCfg.noIntro);
  const fast =
    flags.fast ??
    parseOptionalBoolean(process.env.DREXLER_FAST) ??
    parseOptionalBoolean(fileCfg.fast);

  return { apiKey, model, maxHistory, personaPath, theme, noIntro, fast };
}
