import { describe, expect, test } from "bun:test";
import { Conversation } from "../src/conversation.ts";
import { detectPersonaDrift, handleLine, type ReplDeps } from "../src/repl.ts";
import type { FetchFn } from "../src/llm.ts";
import { MODEL_PRIMARY, type Config } from "../src/types.ts";

function makeDeps(fetchFn?: FetchFn) {
  const conversation = new Conversation("SYS", 50);
  const config: Config = {
    apiKey: "k",
    model: MODEL_PRIMARY,
    maxHistory: 50,
    personaPath: "/tmp/p.md",
  };
  const out: string[] = [];
  const deps: ReplDeps = {
    conversation,
    config,
    print: (s) => out.push(s),
    fetchFn,
  };
  return { deps, out, conversation, config };
}

function sseStream(tokens: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const t of tokens) {
        c.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: null }] })}\n\n`,
          ),
        );
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

describe("handleLine", () => {
  test("V9: empty input → nudge, no history change, no LLM call", async () => {
    let called = false;
    const fetchFn: FetchFn = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };
    const { deps, out, conversation } = makeDeps(fetchFn);
    await handleLine("   ", deps);
    expect(called).toBe(false);
    expect(conversation.length).toBe(0);
    expect(out.join("\n")).toMatch(/Drexler's time is money/);
  });

  test("V7: slash command dispatched locally, no LLM call", async () => {
    let called = false;
    const fetchFn: FetchFn = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };
    const { deps, out, conversation } = makeDeps(fetchFn);
    await handleLine("/help", deps);
    expect(called).toBe(false);
    expect(conversation.length).toBe(0);
    expect(out.join("\n")).toMatch(/Drexler permit/);
  });

  test("/exit returns exit action", async () => {
    const { deps } = makeDeps();
    const action = await handleLine("/exit", deps);
    expect(action.type).toBe("exit");
  });

  test("plain text → LLM call → user + assistant pushed to history", async () => {
    const fetchFn: FetchFn = async () =>
      new Response(sseStream(["Hello ", "intern."]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    const { deps, conversation } = makeDeps(fetchFn);
    await handleLine("Hi Drexler", deps);
    const snap = conversation.snapshot();
    expect(snap.length).toBe(3);
    expect(snap[1]).toEqual({ role: "user", content: "Hi Drexler" });
    expect(snap[2]).toEqual({
      role: "assistant",
      content: "Hello intern.",
    });
  });

  test("V10: stream error → user pushed but assistant NOT pushed (no partial poison)", async () => {
    const fetchFn: FetchFn = async () => {
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
    const { deps, conversation, out } = makeDeps(fetchFn);
    await handleLine("Hi", deps);
    const snap = conversation.snapshot();
    expect(snap.length).toBe(2); // system + user only
    expect(snap[1]?.role).toBe("user");
    expect(out.join("\n")).toMatch(/Trading tantrum/);
  });

  test("V3 fallback: 429 on primary triggers retry, history reflects only final assistant", async () => {
    let calls = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.model === MODEL_PRIMARY) {
        return new Response(null, { status: 429 });
      }
      return new Response(sseStream(["fallback reply"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const { deps, conversation, out } = makeDeps(fetchFn);
    await handleLine("hello", deps);
    expect(calls).toBe(2);
    const snap = conversation.snapshot();
    expect(snap[snap.length - 1]?.content).toBe("fallback reply");
    expect(out.join("\n")).toMatch(/fell back/);
  });
});

describe("detectPersonaDrift", () => {
  test("flags raw 'I' as drift", () => {
    expect(detectPersonaDrift("I think you should...")).toBe(true);
    expect(detectPersonaDrift("I'm happy to help")).toBe(true);
  });

  test("ignores 'I' inside code blocks", () => {
    expect(detectPersonaDrift("```python\nfor I in range(10):\n```")).toBe(false);
  });

  test("ignores 'I' inside inline code", () => {
    expect(detectPersonaDrift("use `I` as loop variable")).toBe(false);
  });

  test("clean Drexler text returns false", () => {
    expect(detectPersonaDrift("Drexler answer now. Stonks go up.")).toBe(false);
  });
});

describe("drift-reminder injection", () => {
  test("system reminder appended every 5 user turns", async () => {
    const requestBodies: any[] = [];
    const fetchFn: FetchFn = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(sseStream(["ok"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const { deps } = makeDeps(fetchFn);
    for (let i = 0; i < 5; i++) {
      await handleLine(`q${i}`, deps);
    }
    const fifthCallMessages = requestBodies[4].messages;
    const lastMsg = fifthCallMessages[fifthCallMessages.length - 1];
    expect(lastMsg.role).toBe("system");
    expect(lastMsg.content).toMatch(/Reminder/);
  });

  test("no reminder on turns not divisible by 5", async () => {
    const requestBodies: any[] = [];
    const fetchFn: FetchFn = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(sseStream(["ok"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const { deps } = makeDeps(fetchFn);
    await handleLine("q1", deps);
    await handleLine("q2", deps);
    const lastMsg2 =
      requestBodies[1].messages[requestBodies[1].messages.length - 1];
    expect(lastMsg2.role).toBe("user");
  });
});

describe("/regenerate flow", () => {
  test("re-runs LLM with last user message, replaces assistant", async () => {
    let callIdx = 0;
    const replies = ["first reply", "second reply"];
    const fetchFn: FetchFn = async () => {
      const tok = replies[callIdx++] ?? "tail";
      return new Response(sseStream([tok]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const { deps, conversation } = makeDeps(fetchFn);
    await handleLine("hi Drexler", deps);
    expect(conversation.snapshot().pop()?.content).toBe("first reply");
    await handleLine("/regenerate", deps);
    expect(conversation.snapshot().pop()?.content).toBe("second reply");
    // Only one user message in history despite two LLM calls
    const userMsgs = conversation
      .snapshot()
      .filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
  });
});
