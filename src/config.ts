import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import type { CliFlags, Config } from "./types.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "./types.ts";

const CONFIG_DIR = join(homedir(), ".config", "drexler");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const LEGACY_CONFIG_PATH = join(homedir(), ".drexlerrc");
const DEFAULT_MAX_HISTORY = 50;

const MODEL_ID_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+(?::[a-z0-9]+)?$/i;

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" && argv[i + 1] !== undefined) {
      flags.model = argv[++i];
    } else if (a === "--persona" && argv[i + 1] !== undefined) {
      flags.persona = argv[++i];
    } else if (a !== undefined && a.startsWith("--model=")) {
      flags.model = a.slice("--model=".length);
    } else if (a !== undefined && a.startsWith("--persona=")) {
      flags.persona = a.slice("--persona=".length);
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
  const path = existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : existsSync(LEGACY_CONFIG_PATH)
    ? LEGACY_CONFIG_PATH
    : null;
  if (!path) return {};
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

export async function saveConfig(partial: Partial<Config>): Promise<void> {
  const existing = await loadConfigFile();
  const merged = { ...existing, ...partial };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
}

const PLACEHOLDER_RE = /your-key-here|sk-or-v1-\.\.\.|^(stub|test|todo)$/i;

export function isValidApiKey(k: string | undefined | null): k is string {
  if (typeof k !== "string") return false;
  const t = k.trim();
  if (t.length === 0) return false;
  if (PLACEHOLDER_RE.test(t)) return false;
  return true;
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

export async function ensureApiKey(): Promise<string> {
  const fileCfg = await loadConfigFile();
  const envKey = process.env.OPENROUTER_API_KEY;
  if (isValidApiKey(envKey)) return envKey.trim();
  if (isValidApiKey(fileCfg.apiKey)) return fileCfg.apiKey.trim();

  console.log("Drexler notice no API key on file. Even CEO need credentials.");
  console.log("Get free key at: https://openrouter.ai/keys");

  const entered = await readApiKeyFromStdin();
  if (!entered) {
    console.error("No API key provided. Drexler refuse to work pro bono.");
    process.exit(1);
  }
  await saveConfig({ apiKey: entered });
  return entered;
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

  const personaPath = flags.persona
    ? resolve(flags.persona)
    : fileCfg.personaPath ?? defaultPersonaPath();

  const maxHistory =
    typeof fileCfg.maxHistory === "number" && fileCfg.maxHistory > 0
      ? fileCfg.maxHistory
      : DEFAULT_MAX_HISTORY;

  return { apiKey, model, maxHistory, personaPath };
}
