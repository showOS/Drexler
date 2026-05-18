import type {
  ContentPart,
  Message,
  OpenRouterRequestBody,
  OutboundMessage,
  StreamChunk,
} from "./types.ts";
import { homedir } from "node:os";
import type { Attachment } from "./attach/types.ts";
import { buildImageDataUrl, buildTextAttachmentBlock, isImage } from "./attach/loader.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_TOKENS = 350;
const TEMPERATURE = 0.95;
const STOP_SEQUENCES = ["Meeting adjourned.", "Severance package incoming.", "Not culture-fit."];
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_STREAM_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [250, 500, 1000] as const;
const MAX_5XX_ATTEMPTS = 3;
const JITTER_PCT = 0.25;
const POST_FALLBACK_429_DELAY_MS = 1000;

function jittered(baseMs: number): number {
  return Math.round(baseMs * (1 + (Math.random() * 2 - 1) * JITTER_PCT));
}

// Compose an optional user-supplied AbortSignal with a timeout signal
// so both surfaces can cancel the same fetch. AbortSignal.any is in
// Bun ≥ 1.1 and Node ≥ 20; we degrade to the timeout-only signal if a
// runtime ever lacks it.
function combineSignals(user: AbortSignal | undefined, ...others: AbortSignal[]): AbortSignal {
  const all = user ? [user, ...others] : others;
  if (all.length === 1) return all[0]!;
  if (
    typeof (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any === "function"
  ) {
    return (AbortSignal as { any: (signals: AbortSignal[]) => AbortSignal }).any(all);
  }
  // Manual fallback: combine via a fresh controller that forwards aborts.
  const controller = new AbortController();
  for (const s of all) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted before retry"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted before retry"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function debugWarn(label: string, detail: string): void {
  if (process.env.DREXLER_DEBUG && process.env.DREXLER_DEBUG !== "0") {
    try {
      process.stderr.write(`[drexler ${label}] ${detail}\n`);
    } catch {
      // best-effort debug log; never crash on a closed stderr
    }
  }
}

export type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface StreamOptions {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  messages: Message[];
  onToken: (token: string) => void;
  signal?: AbortSignal;
  fetchFn?: FetchFn;
  // §V71/V72 — attachments for the last user message. Image attachments
  // require a vision-capable model; non-vision + image ⇒ early refusal,
  // zero HTTP issued.
  attachments?: readonly Attachment[];
}

// §V71 — Model capability registry. Aliases `31b` and `26b` (Gemma 4)
// are text-only. Vision-capable models default to vendor families with
// known multimodal support. Unknown models default to non-vision
// (conservative; user can switch via /model).
export interface ModelCaps {
  vision: boolean;
}

export const MODEL_CAPS: Record<string, ModelCaps> = {
  "google/gemma-4-31b-it": { vision: false },
  "google/gemma-4-26b-a4b-it": { vision: false },
  "openai/gpt-4o": { vision: true },
  "openai/gpt-4o-mini": { vision: true },
  "openai/gpt-4-turbo": { vision: true },
  "anthropic/claude-3-opus": { vision: true },
  "anthropic/claude-3-sonnet": { vision: true },
  "anthropic/claude-3-haiku": { vision: true },
  "anthropic/claude-3.5-sonnet": { vision: true },
  "anthropic/claude-3.5-haiku": { vision: true },
  "google/gemini-pro-1.5": { vision: true },
  "google/gemini-2.0-flash": { vision: true },
  "google/gemini-2.5-pro": { vision: true },
  "meta-llama/llama-3.2-90b-vision-instruct": { vision: true },
  "meta-llama/llama-3.2-11b-vision-instruct": { vision: true },
};

const VISION_PATTERN_HINTS: RegExp[] = [
  /gpt-4o/i,
  /gpt-4-vision/i,
  /claude-3/i,
  /claude-3\.5/i,
  /gemini.*(?:pro|vision|flash|2\.0|2\.5)/i,
  /llama.*vision/i,
];

export function isVisionCapable(modelId: string): boolean {
  const cap = MODEL_CAPS[modelId];
  if (cap) return cap.vision;
  return VISION_PATTERN_HINTS.some((re) => re.test(modelId));
}

export interface StreamResult {
  ok: boolean;
  content: string;
  modelUsed: string;
  error?: string;
  fellBack?: boolean;
  interrupted?: boolean;
  authFailure?: boolean;
  visionRequired?: boolean;
}

// Telemetry: small FIFO ring of the last N stream attempts so `/debug`
// can dump recent outcomes without keeping the full transcript in memory.
// Module-scoped, in-memory only — never persisted to disk.
export interface TelemetryFrame {
  at: number;
  model: string;
  ok: boolean;
  error?: string;
  status?: string;
  modelUsed?: string;
  durationMs?: number;
}

const TELEMETRY_BUFFER_SIZE = 5;
const MAX_TELEMETRY_ERROR_LEN = 500;
const telemetryBuffer: TelemetryFrame[] = [];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeTelemetryText(input: string): string {
  let out = input;
  out = out.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,}\]]+/gi, "$1[redacted]");
  out = out.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  out = out.replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-[redacted]");
  for (const p of [process.env.HOME, process.env.USERPROFILE, homedir()]) {
    if (p && p.length > 1) {
      out = out.replace(new RegExp(escapeRegExp(p), "g"), "~");
    }
  }
  const trimmed = out.trim();
  if (
    trimmed.length > 200 &&
    ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    out = `[redacted JSON body: ${trimmed.length} chars]`;
  }
  if (out.length > MAX_TELEMETRY_ERROR_LEN) {
    out = `${out.slice(0, MAX_TELEMETRY_ERROR_LEN - 3)}...`;
  }
  return out;
}

export function recordTelemetry(frame: TelemetryFrame): void {
  telemetryBuffer.push({
    ...frame,
    error: frame.error ? sanitizeTelemetryText(frame.error) : undefined,
  });
  if (telemetryBuffer.length > TELEMETRY_BUFFER_SIZE) {
    telemetryBuffer.splice(0, telemetryBuffer.length - TELEMETRY_BUFFER_SIZE);
  }
}

export function getRecentTelemetry(): TelemetryFrame[] {
  return telemetryBuffer.map((frame) => ({ ...frame }));
}

export function clearTelemetry(): void {
  telemetryBuffer.length = 0;
}

export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const startedAt = Date.now();
  // §V71 — vision gate. Image attachments + non-vision model ⇒ refuse
  // pre-flight; never issue HTTP. Recorded in telemetry so /debug shows it.
  const hasImage = (opts.attachments ?? []).some(isImage);
  if (hasImage && !isVisionCapable(opts.model)) {
    const result: StreamResult = {
      ok: false,
      content: "",
      modelUsed: opts.model,
      error: `VISION_REQUIRED: model ${opts.model} cannot accept images. Switch model via /model (e.g. openai/gpt-4o, anthropic/claude-3.5-sonnet).`,
      visionRequired: true,
    };
    recordTelemetry({
      at: startedAt,
      model: opts.model,
      ok: false,
      error: result.error,
      status: "vision_required",
      modelUsed: opts.model,
      durationMs: 0,
    });
    return result;
  }
  const finalize = (result: StreamResult, status: string): StreamResult => {
    recordTelemetry({
      at: startedAt,
      model: opts.model,
      ok: result.ok,
      error: result.error,
      status,
      modelUsed: result.modelUsed,
      durationMs: Date.now() - startedAt,
    });
    return result;
  };
  const first = await attempt(opts.model, opts, fetchFn);
  if (first.status !== "rate_limit") {
    return finalize(toResult(first, opts.model, false), first.status);
  }
  if (!opts.fallbackModel || opts.fallbackModel === opts.model) {
    return finalize(toResult(first, opts.model, false), first.status);
  }
  const second = await attempt(opts.fallbackModel, opts, fetchFn);
  if (second.status !== "rate_limit") {
    return finalize(toResult(second, opts.fallbackModel, true), second.status);
  }
  // Both 429 — brief pause, then one more shot at the primary so a
  // transient cross-model burst doesn't dead-end the user.
  try {
    await abortableDelay(POST_FALLBACK_429_DELAY_MS, opts.signal);
  } catch {
    return finalize(toResult(second, opts.fallbackModel, true), second.status);
  }
  const third = await attempt(opts.model, opts, fetchFn);
  if (third.status === "ok") {
    return finalize(toResult(third, opts.model, false), third.status);
  }
  return finalize(toResult(third, opts.model, true), third.status);
}

type AttemptStatus = "ok" | "rate_limit" | "http_error" | "stream_error" | "auth_error";

interface AttemptOutcome {
  status: AttemptStatus;
  content: string;
  error?: string;
}

// §V72 — Build outbound messages. Pure-text turns keep the string-content
// form (back-compat for every existing call site + telemetry redaction).
// Any image attachment switches the LAST user message to OpenAI
// content-array form. Text attachments inline as fenced code blocks
// inside the user message text (already done by App.tsx send path);
// llm.ts threads them through here only when explicitly provided.
export function buildOutboundMessages(
  messages: readonly Message[],
  attachments: readonly Attachment[] = [],
): OutboundMessage[] {
  if (attachments.length === 0) {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
  const images = attachments.filter(isImage);
  const textAtts = attachments.filter((a) => a.kind === "text");

  const out: OutboundMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (out.length === 0) return out;

  // Find last user message; that's where attachments anchor.
  let lastUserIdx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return out;

  const baseUser = out[lastUserIdx]!;
  const baseText = typeof baseUser.content === "string" ? baseUser.content : "";
  const textBlocks = textAtts.map(buildTextAttachmentBlock).filter((s) => s.length > 0);
  const combinedText = [baseText, ...textBlocks].filter((s) => s.length > 0).join("\n\n");

  if (images.length === 0) {
    out[lastUserIdx] = { role: "user", content: combinedText };
    return out;
  }

  const parts: ContentPart[] = [];
  if (combinedText.length > 0) parts.push({ type: "text", text: combinedText });
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: buildImageDataUrl(img) } });
  }
  out[lastUserIdx] = { role: "user", content: parts };
  return out;
}

async function attempt(
  model: string,
  opts: StreamOptions,
  fetchFn: FetchFn,
  attemptNumber: number = 1,
): Promise<AttemptOutcome> {
  const body: OpenRouterRequestBody = {
    model,
    messages: buildOutboundMessages(opts.messages, opts.attachments ?? []),
    stream: true,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    stop: STOP_SEQUENCES,
  };
  let res: Response;
  // Compose the user's abort with a connect-timeout signal so a
  // hung TLS handshake or DNS resolution doesn't leave the spinner
  // frozen forever. The user abort still cancels at any time.
  const connectSignal = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
  const combinedSignal = combineSignals(opts.signal, connectSignal);
  try {
    res = await fetchFn(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/showOS/Drexler",
        "X-Title": "Drexler CLI",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    const userAborted = opts.signal?.aborted === true;
    if (
      !userAborted &&
      err instanceof Error &&
      /timeout|timed out/i.test(err.name + " " + err.message)
    ) {
      return {
        status: "http_error",
        content: "",
        error: `connect timeout after ${CONNECT_TIMEOUT_MS / 1000}s`,
      };
    }
    return {
      status: "http_error",
      content: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 429) {
    return { status: "rate_limit", content: "", error: "429 rate limited" };
  }

  if (res.status === 401 || res.status === 403) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // best-effort: response body unavailable, surface bare status
    }
    return {
      status: "auth_error",
      content: "",
      error: `HTTP ${res.status}: API key rejected by OpenRouter. ${detail.slice(0, 120)}`,
    };
  }

  if (res.status >= 500 && res.status <= 599 && attemptNumber < MAX_5XX_ATTEMPTS) {
    try {
      await res.text();
    } catch {
      // best-effort: drain body before retry; ignore read failures
    }
    // Exponential backoff with jitter — abortable. Delay before the
    // *next* attempt: 250ms before attempt #2, 500ms before attempt #3.
    const delayMs = jittered(RETRY_DELAYS_MS[attemptNumber - 1] ?? 1000);
    try {
      await abortableDelay(delayMs, opts.signal);
    } catch (err) {
      return {
        status: "http_error",
        content: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return attempt(model, opts, fetchFn, attemptNumber + 1);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // best-effort: response body unavailable, surface bare status
    }
    return {
      status: "http_error",
      content: "",
      error: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
    };
  }

  if (!res.body) {
    return { status: "stream_error", content: "", error: "No response body" };
  }

  const parsed = await parseSSEStream(res.body, opts.onToken);
  if (!parsed.complete) {
    return {
      status: "stream_error",
      content: parsed.content,
      error: parsed.error ?? "Stream interrupted",
    };
  }
  return { status: "ok", content: parsed.content };
}

function toResult(outcome: AttemptOutcome, modelUsed: string, fellBack: boolean): StreamResult {
  return {
    ok: outcome.status === "ok",
    content: outcome.content,
    modelUsed,
    error: outcome.error ? sanitizeTelemetryText(outcome.error) : undefined,
    fellBack,
    interrupted: outcome.status === "stream_error" && outcome.content.length > 0,
    authFailure: outcome.status === "auth_error",
  };
}

export interface SSEParseResult {
  content: string;
  complete: boolean;
  error?: string;
}

// Common-case shape we extract without a full JSON.parse:
//   {"id":"...","choices":[{"delta":{"content":"..."},"finish_reason":null}],...}
// We look for both keys, then slice the content between the quotes. Any
// JSON escape in the content forces a fallback to JSON.parse so we
// never decode incorrectly.
const FAST_PATH_CONTENT_KEY = '"content":"';
const FAST_PATH_FINISH_KEY = '"finish_reason"';

function tryFastPathContent(data: string): string | null {
  const ci = data.indexOf(FAST_PATH_CONTENT_KEY);
  if (ci === -1) return null;
  if (data.indexOf(FAST_PATH_FINISH_KEY) === -1) return null;
  const start = ci + FAST_PATH_CONTENT_KEY.length;
  let end = start;
  while (end < data.length) {
    const code = data.charCodeAt(end);
    if (code === 0x22 /* " */) break;
    if (code === 0x5c /* \\ */) return null; // any escape → fallback
    end++;
  }
  if (end >= data.length || data.charCodeAt(end) !== 0x22) return null;
  return data.slice(start, end);
}

export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
  idleTimeoutMs: number = IDLE_STREAM_TIMEOUT_MS,
): Promise<SSEParseResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  let doneSeen = false;
  let idleTimedOut = false;
  const processLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data.toUpperCase() === "[DONE]") {
      doneSeen = true;
      return;
    }
    try {
      // Most chunks are the common `delta.content` shape with no JSON
      // escapes in the content — slice them out directly to skip the
      // full JSON.parse. Any escape or alternate shape falls back to
      // JSON.parse below, so correctness is preserved.
      const fast = tryFastPathContent(data);
      if (fast !== null) {
        if (fast.length > 0) {
          acc += fast;
          onToken(fast);
        }
        return;
      }
      const chunk = JSON.parse(data) as StreamChunk;
      const tok = chunk.choices?.[0]?.delta?.content;
      if (typeof tok === "string" && tok.length > 0) {
        acc += tok;
        onToken(tok);
      }
    } catch (err) {
      // Tolerate malformed chunks — OpenRouter occasionally emits
      // partial JSON during slow connections. Visible only when
      // DREXLER_DEBUG is set so production stays quiet.
      const msg = err instanceof Error ? err.message : String(err);
      debugWarn("sse parse", `${msg}: ${data.slice(0, 80)}`);
    }
  };

  try {
    while (!doneSeen) {
      // Race the chunk read against an idle timeout so the spinner can't
      // hang forever on a server that opened the SSE connection then
      // stopped sending. Timer resets each loop so a slow but live
      // stream keeps flowing.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idlePromise = new Promise<{ value?: Uint8Array; done: true }>((_, reject) => {
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          reject(new Error(`idle stream timeout after ${idleTimeoutMs / 1000}s`));
        }, idleTimeoutMs);
      });
      let readResult: { value?: Uint8Array; done: boolean };
      try {
        readResult = await Promise.race([reader.read(), idlePromise]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      const { value, done } = readResult;
      if (done) {
        // Flush any incomplete UTF-8 sequence at end of stream.
        buf += decoder.decode();
        break;
      }
      if (value) buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const rawLine = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        processLine(rawLine);
        if (doneSeen) return { content: acc, complete: true };
      }
    }
    if (buf.length > 0) processLine(buf);
    return { content: acc, complete: doneSeen };
  } catch (err) {
    if (!doneSeen) {
      try {
        await reader.cancel().catch(() => {});
      } catch {
        // best-effort cleanup
      }
    }
    return {
      content: acc,
      complete: false,
      error: idleTimedOut
        ? `idle stream timeout after ${idleTimeoutMs / 1000}s`
        : err instanceof Error
          ? err.message
          : undefined,
    };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort: reader may already be released after stream completion
    }
  }
}
