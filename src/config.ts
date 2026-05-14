import { existsSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import type { CliFlags, Config, ThemeName } from "./types.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, THEME_NAMES } from "./types.ts";

const DEFAULT_MAX_HISTORY = 50;

export function getDrexlerVersion(): string {
  try {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getConfigPath(): string {
  return configPath();
}

export function getLegacyConfigPath(): string {
  return legacyConfigPath();
}

export function getResolvedConfigPath(): string | null {
  const cp = configPath();
  const lp = legacyConfigPath();
  if (existsSync(cp)) return cp;
  if (existsSync(lp)) return lp;
  return null;
}

export type ApiKeySource = "env" | "config-file" | "missing";

export class LaunchConfigError extends Error {
  readonly reason: "model-alias" | "persona-path" | "config-unreadable" | "api-key-empty";
  readonly detail: Record<string, unknown>;
  constructor(
    reason: LaunchConfigError["reason"],
    message: string,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LaunchConfigError";
    this.reason = reason;
    this.detail = detail;
  }
}

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
    } else if (a === "--resume") {
      flags.resume = true;
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

async function validatePersonaFile(inputPath: unknown, label: string): Promise<string> {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new LaunchConfigError(
      "persona-path",
      `Invalid ${label}: expected a regular .md file path.`,
      { path: inputPath },
    );
  }
  const resolved = resolve(inputPath);
  // lstat (not stat) so symlinks pointing to non-.md targets cannot bypass
  // the extension check via `ln -s /etc/passwd evil.md`.
  const st = await lstat(resolved).catch(() => null);
  if (!st?.isFile() || st.isSymbolicLink() || !resolved.toLowerCase().endsWith(".md")) {
    throw new LaunchConfigError(
      "persona-path",
      `Invalid ${label}: ${inputPath} (must be a regular .md file; symlinks rejected).`,
      { path: inputPath },
    );
  }
  return resolved;
}

async function readConfigPath(
  path: string,
): Promise<
  | { raw: string; missing: false }
  | { raw: null; missing: true }
  | { raw: null; missing: false; error: NodeJS.ErrnoException }
> {
  try {
    return { raw: await readFile(path, "utf-8"), missing: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { raw: null, missing: true };
    return { raw: null, missing: false, error: err as NodeJS.ErrnoException };
  }
}

// Cache the parsed config file for the lifetime of a single startup
// pass. validateLaunchConfig, resolveConfig, ensureApiKey, and
// describeApiKeySource all hit loadConfigFile back-to-back during boot;
// without the cache we paid 3+ fs.readFile + JSON.parse cycles per
// launch on what is the same byte-identical file. saveConfig
// invalidates so writes are still visible to subsequent reads.
let configFileCache: Partial<Config> | null = null;

export function invalidateConfigFileCache(): void {
  configFileCache = null;
}

export async function loadConfigFile(): Promise<Partial<Config>> {
  if (configFileCache !== null) return configFileCache;
  // Try canonical XDG path first, then legacy ~/.drexlerrc. Reading
  // unconditionally (instead of gating on existsSync) means EACCES
  // surfaces a warning rather than silently masquerading as "no file".
  for (const path of [configPath(), legacyConfigPath()]) {
    const result = await readConfigPath(path);
    if (result.missing) continue;
    if (result.raw === null) {
      console.warn(
        `Drexler config at ${path} could not be read (${result.error.code ?? result.error.message}); ignoring (defaults applied).`,
      );
      configFileCache = {};
      return configFileCache;
    }
    try {
      const parsed: unknown = JSON.parse(result.raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.warn(
          `Drexler config at ${path} is not a JSON object; ignoring (defaults applied).`,
        );
        configFileCache = {};
        return configFileCache;
      }
      configFileCache = parsed as Partial<Config>;
      return configFileCache;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `Drexler config at ${path} could not be parsed (${msg}); ignoring (defaults applied).`,
      );
      configFileCache = {};
      return configFileCache;
    }
  }
  configFileCache = {};
  return configFileCache;
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
  const tmp = `${target}.tmp.${process.pid}.${randomUUID()}`;
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
  } catch {
    // best-effort: chmod failure on a successfully written config is non-fatal
  }
  // Drop the cache so subsequent reads see the merged state. Cheaper
  // than rewriting the cache to `merged` because there are usually
  // zero or one reads after a save in a startup pass.
  invalidateConfigFileCache();
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

export interface LaunchStructural {
  model: string;
  personaPath: string;
  theme?: ThemeName;
  noIntro?: boolean;
  fast?: boolean;
  maxHistory: number;
  fileCfg: Partial<Config>;
}

export async function validateLaunchConfig(argv: string[]): Promise<LaunchStructural> {
  const flags = parseFlags(argv);
  const fileCfg = await loadConfigFile();
  const envModel = process.env.DREXLER_MODEL;

  const modelInput = flags.model ?? envModel ?? fileCfg.model ?? "31b";
  let model: string;
  try {
    model = resolveModel(modelInput);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new LaunchConfigError("model-alias", msg, { input: modelInput });
  }

  const personaPath = flags.persona
    ? await validatePersonaFile(flags.persona, "--persona")
    : fileCfg.personaPath !== undefined
      ? await validatePersonaFile(fileCfg.personaPath, "config personaPath")
      : await validatePersonaFile(defaultPersonaPath(), "default persona");

  const maxHistory =
    typeof fileCfg.maxHistory === "number" &&
    Number.isInteger(fileCfg.maxHistory) &&
    fileCfg.maxHistory >= 3
      ? fileCfg.maxHistory
      : DEFAULT_MAX_HISTORY;

  const themeCandidate = flags.theme ?? process.env.DREXLER_THEME ?? fileCfg.theme;
  const theme =
    typeof themeCandidate === "string" && THEME_NAMES.includes(themeCandidate as ThemeName)
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

  return { model, personaPath, theme, noIntro, fast, maxHistory, fileCfg };
}

export async function describeApiKeySource(): Promise<{
  source: ApiKeySource;
  configPath: string | null;
}> {
  const envKey = process.env.OPENROUTER_API_KEY;
  if (isValidApiKey(envKey)) return { source: "env", configPath: null };
  const fileCfg = await loadConfigFile();
  if (isValidApiKey(fileCfg.apiKey)) {
    return { source: "config-file", configPath: getResolvedConfigPath() };
  }
  return { source: "missing", configPath: null };
}

export async function resolveConfig(argv: string[]): Promise<Config> {
  const structural = await validateLaunchConfig(argv);
  const envKey = process.env.OPENROUTER_API_KEY;
  const apiKey = isValidApiKey(envKey)
    ? envKey.trim()
    : isValidApiKey(structural.fileCfg.apiKey)
      ? structural.fileCfg.apiKey.trim()
      : "";
  if (!apiKey) {
    throw new LaunchConfigError(
      "api-key-empty",
      "API key missing. Run drexler interactively to set one, or export OPENROUTER_API_KEY.",
    );
  }
  return {
    apiKey,
    model: structural.model,
    maxHistory: structural.maxHistory,
    personaPath: structural.personaPath,
    theme: structural.theme,
    noIntro: structural.noIntro,
    fast: structural.fast,
  };
}
