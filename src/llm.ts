import type { Message, OpenRouterRequestBody, StreamChunk } from "./types.ts";

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
    } catch {}
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
}

export interface StreamResult {
  ok: boolean;
  content: string;
  modelUsed: string;
  error?: string;
  fellBack?: boolean;
  interrupted?: boolean;
  authFailure?: boolean;
}

export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const first = await attempt(opts.model, opts, fetchFn);
  if (first.status !== "rate_limit") return toResult(first, opts.model, false);
  if (!opts.fallbackModel || opts.fallbackModel === opts.model) {
    return toResult(first, opts.model, false);
  }
  const second = await attempt(opts.fallbackModel, opts, fetchFn);
  if (second.status !== "rate_limit") {
    return toResult(second, opts.fallbackModel, true);
  }
  // Both 429 — brief pause, then one more shot at the primary so a
  // transient cross-model burst doesn't dead-end the user.
  try {
    await abortableDelay(POST_FALLBACK_429_DELAY_MS, opts.signal);
  } catch {
    return toResult(second, opts.fallbackModel, true);
  }
  const third = await attempt(opts.model, opts, fetchFn);
  if (third.status === "ok") return toResult(third, opts.model, false);
  return toResult(third, opts.model, true);
}

type AttemptStatus = "ok" | "rate_limit" | "http_error" | "stream_error" | "auth_error";

interface AttemptOutcome {
  status: AttemptStatus;
  content: string;
  error?: string;
}

async function attempt(
  model: string,
  opts: StreamOptions,
  fetchFn: FetchFn,
  attemptNumber: number = 1,
): Promise<AttemptOutcome> {
  const body: OpenRouterRequestBody = {
    model,
    messages: opts.messages,
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
    } catch {}
    return {
      status: "auth_error",
      content: "",
      error: `HTTP ${res.status}: API key rejected by OpenRouter. ${detail.slice(0, 120)}`,
    };
  }

  if (res.status >= 500 && res.status <= 599 && attemptNumber < MAX_5XX_ATTEMPTS) {
    try {
      await res.text();
    } catch {}
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
    } catch {}
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
    error: outcome.error,
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
    } catch {}
  }
}
