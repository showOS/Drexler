import { describe, expect, test } from "bun:test";
import { Conversation } from "../src/conversation.ts";
import {
  buildMessagesWithReminder,
  detectPersonaDrift,
  handleLine,
  pickFallback,
  type ReplDeps,
} from "../src/repl.ts";
import type { FetchFn } from "../src/llm.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "../src/types.ts";
import { DRIFT_REMINDER, REMINDER_INTERVAL } from "../src/sayings.ts";

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

  test("flags Cyrillic capital I confusable", () => {
    expect(detectPersonaDrift("І think you should...")).toBe(true);
  });

  test("flags Roman numeral I (U+2160)", () => {
    expect(detectPersonaDrift("Ⅰ think you should...")).toBe(true);
  });

  test("flags fullwidth I", () => {
    expect(detectPersonaDrift("Ｉ am happy to help")).toBe(true);
  });

  test("flags Greek capital and lowercase iota", () => {
    expect(detectPersonaDrift("Ι will revisit")).toBe(true);
    expect(detectPersonaDrift("ι think we should")).toBe(true);
  });

  test("ignores 'I' inside LaTeX inline math", () => {
    expect(detectPersonaDrift("Recall $I = mc^2$ from physics.")).toBe(false);
  });

  test("ignores 'I' inside LaTeX display math", () => {
    expect(detectPersonaDrift("$$\\int I \\,dx$$ and Drexler continues.")).toBe(false);
  });

  test("still flags 'I' next to math fences", () => {
    expect(detectPersonaDrift("Recall $E = mc^2$ but I disagree.")).toBe(true);
  });
});

describe("pickFallback", () => {
  test("returns fallback when current is primary", () => {
    expect(pickFallback(MODEL_PRIMARY)).toBe(MODEL_FALLBACK);
  });

  test("returns primary when current is fallback", () => {
    expect(pickFallback(MODEL_FALLBACK)).toBe(MODEL_PRIMARY);
  });

  test("returns primary for unknown model", () => {
    expect(pickFallback("anthropic/claude-3-haiku")).toBe(MODEL_PRIMARY);
  });
});

describe("buildMessagesWithReminder", () => {
  test("does not inject reminder before first turn", () => {
    const conv = new Conversation("SYS", 50);
    expect(buildMessagesWithReminder(conv).at(-1)?.content).not.toBe(DRIFT_REMINDER);
  });

  test("injects reminder exactly on REMINDER_INTERVAL boundary", () => {
    const conv = new Conversation("SYS", 50);
    for (let i = 0; i < REMINDER_INTERVAL; i++) {
      conv.push("user", `q${i}`);
      conv.push("assistant", `a${i}`);
    }
    const msgs = buildMessagesWithReminder(conv);
    expect(msgs.at(-1)?.role).toBe("system");
    expect(msgs.at(-1)?.content).toBe(DRIFT_REMINDER);
  });

  test("does not inject reminder mid-cadence", () => {
    const conv = new Conversation("SYS", 50);
    conv.push("user", "q1");
    conv.push("assistant", "a1");
    expect(buildMessagesWithReminder(conv).at(-1)?.content).not.toBe(DRIFT_REMINDER);
  });

  test("keeps reminder cadence after conversation history trims", () => {
    const conv = new Conversation("SYS", 50);
    const reminderTurns: number[] = [];
    for (let i = 1; i <= 30; i++) {
      conv.push("user", `q${i}`);
      if (buildMessagesWithReminder(conv).at(-1)?.content === DRIFT_REMINDER) {
        reminderTurns.push(i);
      }
      conv.push("assistant", `a${i}`);
    }

    expect(reminderTurns).toEqual([5, 10, 15, 20, 25, 30]);
  });
});

describe("drift-reminder injection", () => {
  test("system reminder appended every 5 user turns", async () => {
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
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
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
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
    const lastMsg2 = requestBodies[1].messages[requestBodies[1].messages.length - 1];
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
    const userMsgs = conversation.snapshot().filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
  });
});
