import type { Message, OpenRouterRequestBody, StreamChunk } from "./types.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_TOKENS = 350;
const TEMPERATURE = 0.95;
const STOP_SEQUENCES = [
  "Meeting adjourned.",
  "Severance package incoming.",
  "Not culture-fit.",
];
const RETRY_DELAY_MS = 250;

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

export type FetchFn = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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
}

export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const first = await attempt(opts.model, opts, fetchFn);
  if (
    first.status === "rate_limit" &&
    opts.fallbackModel &&
    opts.fallbackModel !== opts.model
  ) {
    const second = await attempt(opts.fallbackModel, opts, fetchFn);
    return toResult(second, opts.fallbackModel, true);
  }
  return toResult(first, opts.model, false);
}

type AttemptStatus = "ok" | "rate_limit" | "http_error" | "stream_error";

interface AttemptOutcome {
  status: AttemptStatus;
  content: string;
  error?: string;
}

async function attempt(
  model: string,
  opts: StreamOptions,
  fetchFn: FetchFn,
  isRetry: boolean = false,
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
      signal: opts.signal,
    });
  } catch (err) {
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
      status: "http_error",
      content: "",
      error: `HTTP ${res.status}: API key rejected by OpenRouter. Update via .env (OPENROUTER_API_KEY=...) or run "rm ~/.config/drexler/config.json" to re-prompt. ${detail.slice(0, 120)}`,
    };
  }

  if (res.status >= 500 && res.status <= 599 && !isRetry) {
    try {
      await res.text();
    } catch {}
    // Retry delay must be abortable — if the user hits Esc during the
    // wait, we should bail immediately instead of firing the second
    // request only to cancel it once issued.
    try {
      await abortableDelay(RETRY_DELAY_MS, opts.signal);
    } catch (err) {
      return {
        status: "http_error",
        content: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return attempt(model, opts, fetchFn, true);
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
      error: "Stream interrupted",
    };
  }
  return { status: "ok", content: parsed.content };
}

function toResult(
  outcome: AttemptOutcome,
  modelUsed: string,
  fellBack: boolean,
): StreamResult {
  return {
    ok: outcome.status === "ok",
    content: outcome.content,
    modelUsed,
    error: outcome.error,
    fellBack,
    interrupted:
      outcome.status === "stream_error" && outcome.content.length > 0,
  };
}

export interface SSEParseResult {
  content: string;
  complete: boolean;
}

export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
): Promise<SSEParseResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  let doneSeen = false;
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
      const { value, done } = await reader.read();
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
  } catch {
    return { content: acc, complete: false };
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}
