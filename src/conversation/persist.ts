import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Conversation } from "../conversation.ts";
import type { Message } from "../types.ts";

const SCHEMA_VERSION = 1;
const MAX_SAVED_MESSAGES = 200;
const MIN_PREVIEW_LEN = 1;
const MAX_PREVIEW_LEN = 200;

export interface SavedSession {
  version: number;
  savedAt: number;
  systemPrompt: string;
  messages: Message[];
  model?: string;
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME?.trim();
  if (xdg && xdg.length > 0) return join(xdg, "drexler");
  return join(getHome(), ".local", "state", "drexler");
}

export function sessionFilePath(): string {
  return join(stateDir(), "last-session.json");
}

export function hasSavedSession(): boolean {
  return existsSync(sessionFilePath());
}

function isMessage(value: unknown): value is Message {
  if (value === null || typeof value !== "object") return false;
  const v = value as { role?: unknown; content?: unknown };
  if (typeof v.content !== "string") return false;
  return v.role === "system" || v.role === "user" || v.role === "assistant";
}

export function loadSavedSession(): SavedSession | null {
  const path = sessionFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const obj = parsed as Partial<SavedSession>;
    if (obj.version !== SCHEMA_VERSION) return null;
    if (typeof obj.savedAt !== "number" || !Number.isFinite(obj.savedAt)) {
      return null;
    }
    if (typeof obj.systemPrompt !== "string") return null;
    if (!Array.isArray(obj.messages)) return null;
    const messages = obj.messages.filter(isMessage);
    return {
      version: SCHEMA_VERSION,
      savedAt: obj.savedAt,
      systemPrompt: obj.systemPrompt,
      messages,
      model: typeof obj.model === "string" ? obj.model : undefined,
    };
  } catch {
    return null;
  }
}

// Atomic write: temp + rename so a crash mid-save leaves the prior
// session intact rather than truncated. Async so a ~25KB JSON write on
// every turn doesn't block the Ink event loop — caller fires-and-forgets.
export async function saveSession(session: SavedSession): Promise<void> {
  try {
    const dir = stateDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = sessionFilePath();
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    try {
      await writeFile(tmp, JSON.stringify(session, null, 0), {
        encoding: "utf-8",
        mode: 0o600,
      });
      await rename(tmp, target);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {}
      throw err;
    }
  } catch {
    // best-effort persistence; never crash the chat path on save failure
  }
}

export function clearSavedSession(): void {
  try {
    const path = sessionFilePath();
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // best-effort cleanup
  }
}

export function buildSavedSession(
  conversation: Conversation,
  systemPrompt: string,
  model?: string,
): SavedSession {
  const snap = conversation.snapshot();
  // Drop the system message from the persisted body; the live persona
  // (which may have shifted with mood) is re-attached on resume from
  // the current process's systemPrompt.
  const body = snap.filter((m) => m.role !== "system");
  const trimmed = body.length > MAX_SAVED_MESSAGES
    ? body.slice(body.length - MAX_SAVED_MESSAGES)
    : body;
  return {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    systemPrompt,
    messages: trimmed,
    model,
  };
}

export interface SessionPreview {
  savedAt: number;
  messageCount: number;
  lastUserSnippet: string | null;
  lastAssistantSnippet: string | null;
  model?: string;
}

function snippet(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_PREVIEW_LEN) return cleaned;
  return `${cleaned.slice(0, MAX_PREVIEW_LEN - 1)}…`;
}

export function describeSession(session: SavedSession): SessionPreview {
  let lastUser: string | null = null;
  let lastAssistant: string | null = null;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i]!;
    if (!lastAssistant && m.role === "assistant") lastAssistant = snippet(m.content);
    if (!lastUser && m.role === "user") lastUser = snippet(m.content);
    if (lastUser && lastAssistant) break;
  }
  return {
    savedAt: session.savedAt,
    messageCount: session.messages.length,
    lastUserSnippet: lastUser && lastUser.length >= MIN_PREVIEW_LEN ? lastUser : null,
    lastAssistantSnippet:
      lastAssistant && lastAssistant.length >= MIN_PREVIEW_LEN
        ? lastAssistant
        : null,
    model: session.model,
  };
}

export function formatSessionAge(savedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
