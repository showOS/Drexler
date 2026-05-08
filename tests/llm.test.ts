import { describe, expect, test } from "bun:test";
import { parseSSEStream, streamChat } from "../src/llm.ts";
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
  const events = tokens.map((t) =>
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

  test("V3: fallback only retried ONCE (no infinite loop)", async () => {
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
    expect(n).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.fellBack).toBe(true);
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
    // 5xx retries once on the SAME model; never falls back to a different model.
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_PRIMARY]);
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

  test("5xx fails twice → http_error returned, no infinite loop", async () => {
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
    expect(calls).toEqual([MODEL_PRIMARY, MODEL_PRIMARY]);
    expect(result.ok).toBe(false);
    expect(result.fellBack).toBe(false);
    expect(result.error).toMatch(/HTTP 502/);
  });

  test("stop sequence array present in request body sent to fetch", async () => {
    let capturedBody: any = null;
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
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
    expect(Array.isArray(capturedBody.stop)).toBe(true);
    expect(capturedBody.stop).toEqual([
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
    let body: any;
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
    expect(typeof body.max_tokens).toBe("number");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(typeof body.temperature).toBe("number");
    expect(body.stream).toBe(true);
  });

  test("request headers include Authorization Bearer + content-type + UA tags", async () => {
    let headers: any;
    const fetchFn: import("../src/llm.ts").FetchFn = async (_u, init) => {
      headers = init?.headers;
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
    expect(headers.Authorization).toBe("Bearer the-secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["HTTP-Referer"]).toMatch(/^https?:\/\//);
    expect(headers["X-Title"]).toBe("Drexler CLI");
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
    expect(String(url)).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  test("AbortSignal forwarded to fetch", async () => {
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
    expect(receivedSignal).toBe(controller.signal);
  });

  test("401 returns friendly key-rejected message", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () =>
      new Response(`{"error":{"message":"Missing Authentication header","code":401}}`, { status: 401 });
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
    expect(result.error).toMatch(/\.env|config\.json/);
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
