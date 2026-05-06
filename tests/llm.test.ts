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
    const acc = await parseSSEStream(stream, (t) => tokens.push(t));
    expect(tokens).toEqual(["Drex", "ler ", "speak."]);
    expect(acc).toBe("Drexler speak.");
  });

  test("ignores comments and blank lines", async () => {
    const sse = `: ping\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`;
    const out: string[] = [];
    const acc = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(acc).toBe("ok");
  });

  test("tolerates malformed JSON chunks", async () => {
    const sse =
      "data: not-json\n\n" +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "X" }, finish_reason: null }] })}\n\n` +
      "data: [DONE]\n\n";
    const out: string[] = [];
    const acc = await parseSSEStream(streamFromString(sse), (t) => out.push(t));
    expect(acc).toBe("X");
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
    const acc = await parseSSEStream(stream, (t) => out.push(t));
    expect(acc).toBe("hello");
  });

  test("V10: stream error → returns null", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    const out: string[] = [];
    const result = await parseSSEStream(stream, (t) => out.push(t));
    expect(result).toBeNull();
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

  test("V10: stream error returns null content (no partial poison)", async () => {
    const fetchFn: import("../src/llm.ts").FetchFn = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          const enc = new TextEncoder();
          c.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })}\n\n`,
            ),
          );
          c.error(new Error("interrupted"));
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
    expect(result.content).toBeNull();
  });
});
