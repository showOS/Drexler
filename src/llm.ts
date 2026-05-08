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
  content: string | null;
  modelUsed: string;
  error?: string;
  fellBack?: boolean;
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
  content: string | null;
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
      content: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 429) {
    return { status: "rate_limit", content: null, error: "429 rate limited" };
  }

  if (res.status === 401 || res.status === 403) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {}
    return {
      status: "http_error",
      content: null,
      error: `HTTP ${res.status}: API key rejected by OpenRouter. Update via .env (OPENROUTER_API_KEY=...) or run "rm ~/.config/drexler/config.json" to re-prompt. ${detail.slice(0, 120)}`,
    };
  }

  if (res.status >= 500 && res.status <= 599 && !isRetry) {
    try {
      await res.text();
    } catch {}
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return attempt(model, opts, fetchFn, true);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {}
    return {
      status: "http_error",
      content: null,
      error: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
    };
  }

  if (!res.body) {
    return { status: "stream_error", content: null, error: "No response body" };
  }

  const content = await parseSSEStream(res.body, opts.onToken);
  if (content === null) {
    return { status: "stream_error", content: null, error: "Stream interrupted" };
  }
  return { status: "ok", content };
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
  };
}

export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  try {
    while (true) {
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
        const line = rawLine.replace(/\r$/, "").trim();
        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return acc;
        try {
          const chunk = JSON.parse(data) as StreamChunk;
          const tok = chunk.choices?.[0]?.delta?.content;
          if (typeof tok === "string" && tok.length > 0) {
            acc += tok;
            onToken(tok);
          }
        } catch {
          // tolerate malformed chunk
        }
      }
    }
    return acc;
  } catch {
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}
