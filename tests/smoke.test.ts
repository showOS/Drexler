import { describe, expect, test } from "bun:test";
import { Conversation } from "../src/conversation.ts";
import type { FetchFn } from "../src/llm.ts";
import { handleLine, type ReplDeps } from "../src/repl.ts";
import { MODEL_PRIMARY, type Config } from "../src/types.ts";

function sse(tokens: string[]): ReadableStream<Uint8Array> {
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

function makeDeps(fetchFn: FetchFn, maxHistory = 50) {
  const conversation = new Conversation("DREXLER_PERSONA", maxHistory);
  const config: Config = {
    apiKey: "k",
    model: MODEL_PRIMARY,
    maxHistory,
    personaPath: "/tmp/p.md",
  };
  const out: string[] = [];
  const deps: ReplDeps = {
    conversation,
    config,
    print: (s) => out.push(s),
    fetchFn,
  };
  return { deps, out, conversation };
}

describe("smoke: full REPL flow with mocked OpenRouter", () => {
  test("V1+V2+V7: many turns + slash commands → system pinned, history trimmed, slashes not LLM-bound", async () => {
    let llmCalls = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      llmCalls++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const lastUser = body.messages[body.messages.length - 1].content;
      return new Response(sse([`reply-to-${lastUser}`]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const maxHistory = 6; // system + 5 turn-messages max
    const { deps, conversation } = makeDeps(fetchFn, maxHistory);

    // Mix slash and chat.
    await handleLine("/help", deps); // no LLM
    await handleLine("/synergy", deps); // no LLM
    expect(llmCalls).toBe(0); // V7

    // 10 chat turns — should overflow trim window.
    for (let i = 0; i < 10; i++) {
      await handleLine(`q${i}`, deps);
    }

    expect(llmCalls).toBe(10);

    const snap = conversation.snapshot();
    // V1: system at idx 0
    expect(snap[0]?.role).toBe("system");
    expect(snap[0]?.content).toBe("DREXLER_PERSONA");
    // V2: total length capped at maxHistory, without orphaned assistant replies.
    expect(snap.length).toBeLessThanOrEqual(maxHistory);
    expect(snap[1]?.role).not.toBe("assistant");
    // System never duplicated
    const systemCount = snap.filter((m) => m.role === "system").length;
    expect(systemCount).toBe(1);

    // /clear keeps system
    await handleLine("/clear", deps);
    const cleared = conversation.snapshot();
    expect(cleared.length).toBe(1);
    expect(cleared[0]?.role).toBe("system");
  });

  test("V10: stream-error in middle of chat does not corrupt history", async () => {
    let n = 0;
    const fetchFn: FetchFn = async () => {
      n++;
      if (n === 2) {
        // 2nd call errors mid-stream
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "PARTIAL" }, finish_reason: null }] })}\n\n`,
              ),
            );
            c.error(new Error("boom"));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(sse(["ok"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const { deps, conversation } = makeDeps(fetchFn);
    await handleLine("first", deps); // ok
    await handleLine("second", deps); // errors mid-stream
    await handleLine("third", deps); // ok again

    const snap = conversation.snapshot();
    // Expect: system, user-first, asst-ok, user-second, user-third, asst-ok
    // (the failed assistant is NOT recorded)
    const contents = snap.map((m) => `${m.role}:${m.content}`);
    expect(contents).toEqual([
      "system:DREXLER_PERSONA",
      "user:first",
      "assistant:ok",
      "user:second",
      "user:third",
      "assistant:ok",
    ]);
    // No PARTIAL anywhere
    expect(snap.some((m) => m.content.includes("PARTIAL"))).toBe(false);
  });
});
