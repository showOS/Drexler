import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearTelemetry,
  getRecentTelemetry,
  parseSSEStream,
  recordTelemetry,
  sanitizeTelemetryText,
  streamChat,
} from "../src/llm.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "../src/types.ts";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

function makeSSE(tokens: string[]): string {
  const events = tokens.map(
    (t) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: null }] })}\n\n`,
  );
  events.push("data: [DONE]\n\n");
  return events.join("");
}

describe("parseSSEStream", () => {
  test("emits tokens in order, accumulates content", async () => {
    const tokens: string[] = [];
    const stream = streamFromString(makeSSE(["Drex", "ler ", "speak."]));
    const r = await parseSSEStream(stream, (t) => tokens.push(t));
    expect(tokens).toEqual(["Drex", "ler ", "speak."]);
    expect(r).toEqual({ content: "Drexler speak.", complete: true });
  });

  test("ignores comments and blank lines", async () => {
    const sse = `: ping\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`;
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(r).toEqual({ content: "ok", complete: true });
  });

  test("tolerates malformed JSON chunks", async () => {
    const sse =
      "data: not-json\n\n" +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "X" }, finish_reason: null }] })}\n\n` +
      "data: [DONE]\n\n";
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(r).toEqual({ content: "X", complete: true });
  });

  test("handles split chunks across reads", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hel'));
        c.enqueue(enc.encode('lo"},"finish_reason":null}]}\n\n'));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    const out: string[] = [];
    const r = await parseSSEStream(stream, (t) => out.push(t));
    expect(r).toEqual({ content: "hello", complete: true });
  });

  test("handles final line without trailing newline when DONE is present", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}\n\n` +
      "data: [DONE]";
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(out).toEqual(["ok"]);
    expect(r).toEqual({ content: "ok", complete: true });
  });

  test("preserves partial content when stream closes before DONE", async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })}\n\n`;
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(out).toEqual(["partial"]);
    expect(r).toEqual({ content: "partial", complete: false });
  });

  test("V10: stream error → returns partial content with complete=false", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    const out: string[] = [];
    const r = await parseSSEStream(stream, (t) => out.push(t));
    expect(r.complete).toBe(false);
    expect(r.content).toBe("");
  });

  test("fast-path slices content from realistic OpenRouter chunk", async () => {
    const sse =
      'data: {"id":"x","model":"m","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n' +
      "data: [DONE]\n\n";
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(out).toEqual(["hello"]);
    expect(r.content).toBe("hello");
  });

  test("escape sequences fall through to JSON.parse", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "line1\nline2" }, finish_reason: null }] })}\n\n` +
      "data: [DONE]\n\n";
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(out).toEqual(["line1\nline2"]);
    expect(r.content).toBe("line1\nline2");
  });

  test("escaped quote falls through to JSON.parse", async () => {
    const content = 'she said "hi"';
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n` +
      "data: [DONE]\n\n";
    const out: string[] = [];
    const r = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(out).toEqual([content]);
    expect(r.content).toBe(content);
  });

  test("idle stream timeout fires when no chunk arrives", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // never enqueue — simulate a hung server
      },
    });
    const out: string[] = [];
    const r = await parseSSEStream(stream, (t) => out.push(t), 50);
    expect(r.complete).toBe(false);
    expect(r.error ?? "").toMatch(/idle stream timeout/);
  });
});

describe("streamChat (V3 fallback)", () => {
  test("on 429, retries on fallback model", async () => {
    const calls: string[] = [];
    const fetchFn: import("../src/llm.ts").FetchFn = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.model);
      if (body.model === MODEL_PRIMARY) {
        return new Response(null, { status: 429 });
      }
      return new Response(streamFromString(makeSSE(["fallback ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const tokens: string[] = [];
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: (t) => tokens.push(t),
      fetchFn,
    });
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_FALLBACK]);
    expect(result.ok).toBe(true);
    expect(result.fellBack).toBe(true);
    expect(result.modelUsed).toBe(MODEL_FALLBACK);
    expect(result.content).toBe("fallback ok");
  });

  test("429 primary → 429 fallback → 429 primary-retry → http_error (no infinite loop)", async () => {
    let n = 0;
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      n++;
      return new Response(null, { status: 429 });
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    // Three attempts total: primary, fallback, primary-retry-after-pause.
    expect(n).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.fellBack).toBe(true);
  });

  test("429 primary → 429 fallback → 200 primary-retry recovers", async () => {
    const calls: string[] = [];
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.model);
      if (calls.length < 3) {
        return new Response(null, { status: 429 });
      }
      return new Response(streamFromString(makeSSE(["recovered"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_FALLBACK, MODEL_PRIMARY]);
    expect(result.ok).toBe(true);
    expect(result.fellBack).toBe(false);
    expect(result.content).toBe("recovered");
  });

  test("no fallback when same model", async () => {
    let n = 0;
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      n++;
      return new Response(null, { status: 429 });
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(n).toBe(1);
    expect(result.ok).toBe(false);
  });

  test("non-429 error does not trigger fallback", async () => {
    const calls: string[] = [];
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.model);
      return new Response("server down", { status: 500 });
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    // 5xx retries up to 3 attempts on the SAME model with exponential
    // backoff; never falls back to a different model.
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_PRIMARY, MODEL_PRIMARY]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
  });

  test("5xx retried once and succeeds on second attempt", async () => {
    const calls: string[] = [];
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.model);
      if (calls.length === 1) {
        return new Response("transient", { status: 503 });
      }
      return new Response(streamFromString(makeSSE(["recovered"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const tokens: string[] = [];
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: (t) => tokens.push(t),
      fetchFn,
    });
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_PRIMARY]);
    expect(result.ok).toBe(true);
    expect(result.fellBack).toBe(false);
    expect(result.content).toBe("recovered");
  });

  test("5xx fails three times → http_error returned, no infinite loop", async () => {
    const calls: string[] = [];
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.model);
      return new Response("still broken", { status: 502 });
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      fallbackModel: MODEL_FALLBACK,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_PRIMARY, MODEL_PRIMARY]);
    expect(result.ok).toBe(false);
    expect(result.fellBack).toBe(false);
    expect(result.error).toMatch(/HTTP 502/);
  });

  test("stop sequence array present in request body sent to fetch", async () => {
    const captured: { body: Record<string, unknown> | null } = { body: null };
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      captured.body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(streamFromString(makeSSE(["ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(Array.isArray(captured.body?.stop)).toBe(true);
    expect(captured.body?.stop).toEqual([
      "Meeting adjourned.",
      "Severance package incoming.",
      "Not culture-fit.",
    ]);
  });

  test("V10: stream error preserves partial content + sets interrupted", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      let phase = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          const enc = new TextEncoder();
          if (phase === 0) {
            c.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })}\n\n`,
              ),
            );
            phase = 1;
          } else {
            c.error(new Error("interrupted"));
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const tokens: string[] = [];
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: (t) => tokens.push(t),
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("partial");
    expect(result.interrupted).toBe(true);
  });

  test("request body includes max_tokens and temperature", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(streamFromString(makeSSE(["ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(typeof body?.max_tokens).toBe("number");
    expect(body?.max_tokens as number).toBeGreaterThan(0);
    expect(typeof body?.temperature).toBe("number");
    expect(body?.stream).toBe(true);
  });

  test("request headers include Authorization Bearer + content-type + UA tags", async () => {
    let headers: Record<string, string> | undefined;
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      headers = init?.headers as Record<string, string> | undefined;
      return new Response(streamFromString(makeSSE(["ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    await streamChat({
      apiKey: "the-secret-key",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(headers?.Authorization).toBe("Bearer the-secret-key");
    expect(headers?.["Content-Type"]).toBe("application/json");
    expect(headers?.["HTTP-Referer"]).toMatch(/^https?:\/\//);
    expect(headers?.["X-Title"]).toBe("Drexler CLI");
  });

  test("request POSTs to OpenRouter chat completions URL", async () => {
    let url: string | URL | Request | undefined;
    const fetchFn: import("../src/llm.ts").FetchFn = async (u, init) => {
      url = u;
      expect(init?.method).toBe("POST");
      return new Response(streamFromString(makeSSE(["ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  test("AbortSignal forwarded to fetch (composed with connect timeout)", async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response(streamFromString(makeSSE(["ok"])), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const controller = new AbortController();
    await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      signal: controller.signal,
      fetchFn,
    });
    // The signal forwarded to fetch is now a composition of the user
    // controller + a 10s connect timeout. Aborting the controller must
    // still cancel that composed signal.
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(false);
    controller.abort();
    expect(receivedSignal!.aborted).toBe(true);
  });

  test("401 returns friendly key-rejected message", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () =>
      new Response(`{"error":{"message":"Missing Authentication header","code":401}}`, {
        status: 401,
      });
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 401/);
    expect(result.error).toMatch(/API key rejected/);
    expect(result.authFailure).toBe(true);
  });

  test("403 returns friendly key-rejected message", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () =>
      new Response("forbidden", { status: 403 });
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/API key rejected/);
  });

  test("aborted fetch returns http_error result", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const result = await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/aborted/i);
  });
});

describe("telemetry ring buffer (§T13, V39)", () => {
  beforeEach(() => {
    clearTelemetry();
  });

  test("recordTelemetry pushes a frame retrievable via getRecentTelemetry", () => {
    recordTelemetry({
      at: 1_700_000_000_000,
      model: MODEL_PRIMARY,
      ok: true,
      status: "ok",
      modelUsed: MODEL_PRIMARY,
      durationMs: 42,
    });
    const frames = getRecentTelemetry();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      model: MODEL_PRIMARY,
      ok: true,
      status: "ok",
      durationMs: 42,
    });
  });

  test("buffer trims to 5 frames FIFO", () => {
    for (let i = 0; i < 8; i++) {
      recordTelemetry({
        at: i,
        model: MODEL_PRIMARY,
        ok: i % 2 === 0,
        status: `s${i}`,
      });
    }
    const frames = getRecentTelemetry();
    expect(frames).toHaveLength(5);
    // Oldest three (at 0,1,2) dropped; remaining is 3..7
    expect(frames.map((f) => f.at)).toEqual([3, 4, 5, 6, 7]);
  });

  test("getRecentTelemetry returns a defensive copy", () => {
    recordTelemetry({ at: 1, model: MODEL_PRIMARY, ok: true });
    const snap = getRecentTelemetry();
    snap.push({ at: 999, model: "fake", ok: false });
    snap[0]!.model = "mutated";
    expect(getRecentTelemetry()).toHaveLength(1);
    expect(getRecentTelemetry()[0]!.model).toBe(MODEL_PRIMARY);
  });

  test("streamChat records a frame on http_error outcome", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      throw new Error("network down");
    };
    await streamChat({
      apiKey: "k",
      model: MODEL_PRIMARY,
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
      fetchFn,
    });
    const frames = getRecentTelemetry();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const last = frames[frames.length - 1]!;
    expect(last.ok).toBe(false);
    expect(last.model).toBe(MODEL_PRIMARY);
    expect(last.status).toBe("http_error");
    expect(typeof last.durationMs).toBe("number");
    expect(last.error).toMatch(/network down/);
  });

  test("sanitizes secrets, home paths, and long JSON bodies", () => {
    const origHome = process.env.HOME;
    try {
      process.env.HOME = "/Users/example";
      expect(
        sanitizeTelemetryText(
          "Authorization: Bearer sk-or-v1-secret bearer abc.def /Users/example/project",
        ),
      ).toBe("Authorization: [redacted] Bearer [redacted] ~/project");
      const body = JSON.stringify({ error: "x".repeat(260) });
      expect(sanitizeTelemetryText(body)).toMatch(/^\[redacted JSON body:/);
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
    }
  });

  test("recordTelemetry stores sanitized errors only", () => {
    recordTelemetry({
      at: 1,
      model: MODEL_PRIMARY,
      ok: false,
      error: "Bearer sk-or-v1-secret",
    });
    const error = getRecentTelemetry()[0]!.error ?? "";
    expect(error).toContain("[redacted]");
    expect(error).not.toContain("sk-or-v1-secret");
  });
});
