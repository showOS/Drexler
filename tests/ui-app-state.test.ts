import { describe, expect, test } from "bun:test";
import { render, renderToString, useStdout } from "ink";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import React from "react";
import { dispatch } from "../src/commands.ts";
import { Conversation } from "../src/conversation.ts";
import { loadSavedSession } from "../src/conversation/persist.ts";
import type { FetchFn } from "../src/llm.ts";
import { App } from "../src/ui/App.tsx";
import {
  historyNavStep,
  makeDebouncer,
  nextTranscriptScrollOffset,
  replaceExitTimer,
  shouldRemoveVisibleAssistantForAction,
  transcriptRowsForTerminalRows,
} from "../src/ui/App.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY, type Config } from "../src/types.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderAppWithStdout(
  props: React.ComponentProps<typeof App>,
  columns: number,
  rows: number,
): string {
  const stdout = {
    columns,
    rows,
    isTTY: true,
    on: () => undefined,
    off: () => undefined,
  } as unknown as NodeJS.WriteStream;
  function StdoutBackedApp() {
    const ctx = useStdout();
    (ctx as { stdout: NodeJS.WriteStream }).stdout = stdout;
    return React.createElement(App, props);
  }
  return renderToString(
    React.createElement(StdoutBackedApp),
    { columns },
  ).replace(ANSI_RE, "");
}

function makeCtx() {
  const conversation = new Conversation("SYS", 50);
  const config: Config = {
    apiKey: "k",
    model: MODEL_PRIMARY,
    maxHistory: 50,
    personaPath: "/tmp/p.md",
  };
  return {
    conversation,
    config,
    print: () => undefined,
  };
}

function makeInteractiveStreams() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: () => void;
    ref: () => PassThrough;
    unref: () => PassThrough;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => undefined;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;

  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as Writable & {
    columns: number;
    rows: number;
    isTTY: boolean;
    cursorTo: () => void;
    clearLine: () => void;
    moveCursor: () => void;
  };
  stdout.columns = 96;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.cursorTo = () => undefined;
  stdout.clearLine = () => undefined;
  stdout.moveCursor = () => undefined;

  return { stdin, stdout };
}

// Event-driven wait: poll `predicate` at a fast cadence; resolve on first
// truthy result, reject on timeout. Used to replace fixed-duration `delay`
// calls that were really waiting for an observable side-effect (a fetch,
// a conversation update, a persisted session change).
function waitFor<T>(
  predicate: () => T | null | undefined | false,
  {
    timeoutMs = 2000,
    intervalMs = 5,
    label = "condition",
  }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      let result: T | null | undefined | false;
      try {
        result = predicate();
      } catch (err) {
        clearInterval(handle);
        reject(err);
        return;
      }
      if (result) {
        clearInterval(handle);
        resolve(result as T);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(handle);
        reject(new Error(`waitFor timeout: ${label}`));
      }
    };
    const handle = setInterval(tryOnce, intervalMs);
    tryOnce();
  });
}

function streamResponse(content: string): Response {
  const chunk = JSON.stringify({
    choices: [{ delta: { content }, finish_reason: null }],
  });
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("App state helpers", () => {
  test("does not remove an older visible assistant when regenerate follows a failed turn", () => {
    const ctx = makeCtx();
    ctx.conversation.push("user", "first");
    ctx.conversation.push("assistant", "first reply");
    ctx.conversation.push("user", "second failed turn");

    const action = dispatch("/regenerate", ctx);

    expect(action.type).toBe("regenerate");
    expect(shouldRemoveVisibleAssistantForAction(action)).toBe(false);
  });

  test("removes visible assistant only when command history actually removed one", () => {
    const ctx = makeCtx();
    ctx.conversation.push("user", "first");
    ctx.conversation.push("assistant", "first reply");

    const action = dispatch("/regenerate", ctx);

    expect(action.type).toBe("regenerate");
    expect(shouldRemoveVisibleAssistantForAction(action)).toBe(true);
  });

  test("keeps transcript row budget valid on very short terminals", () => {
    expect(transcriptRowsForTerminalRows(8)).toBe(1);
    expect(transcriptRowsForTerminalRows(24)).toBe(12);
    expect(transcriptRowsForTerminalRows(80)).toBe(24);
  });

  test("scroll offset moves within transcript bounds", () => {
    expect(
      nextTranscriptScrollOffset({
        current: 0,
        itemCount: 10,
        direction: "older",
      }),
    ).toBe(3);
    expect(
      nextTranscriptScrollOffset({
        current: 8,
        itemCount: 10,
        direction: "older",
      }),
    ).toBe(9);
    expect(
      nextTranscriptScrollOffset({
        current: 2,
        itemCount: 10,
        direction: "newer",
      }),
    ).toBe(0);
  });

  test("scroll offset can use rendered row bounds for oversized cards", () => {
    expect(
      nextTranscriptScrollOffset({
        current: 0,
        totalRows: 60,
        visibleRows: 8,
        direction: "older",
      }),
    ).toBe(3);
    expect(
      nextTranscriptScrollOffset({
        current: 51,
        totalRows: 60,
        visibleRows: 8,
        direction: "older",
      }),
    ).toBe(52);
    expect(
      nextTranscriptScrollOffset({
        current: 2,
        totalRows: 60,
        visibleRows: 8,
        direction: "newer",
      }),
    ).toBe(0);
  });

  test("App renders the integrated initial chrome", () => {
    const ctx = makeCtx();
    const fetchFn: FetchFn = async () =>
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    const rendered = renderToString(
      React.createElement(App, {
        conversation: ctx.conversation,
        config: ctx.config,
        mood: "ruthless",
        fetchFn,
      }),
    );

    expect(rendered).toContain("Drexler Deal Desk");
    expect(rendered).toContain("BOARDROOM");
    expect(rendered).toContain("0 memos");
    expect(rendered).toContain("fees ");
  });

  test("App unmount flushes pending persistence with the active model", async () => {
    const origHome = process.env.HOME;
    const origXdg = process.env.XDG_STATE_HOME;
    const home = await mkdtemp(join(tmpdir(), "drexler-app-persist-"));
    const { stdin, stdout } = makeInteractiveStreams();
    const ctx = makeCtx();
    let didUnmount = false;
    try {
      process.env.HOME = home;
      delete process.env.XDG_STATE_HOME;

      // Resolve when the App actually issues the OpenRouter fetch — the
      // moment we know `hello` has been committed to the conversation
      // and the stream is about to drain.
      let fetchCalled!: () => void;
      const fetchPromise = new Promise<void>((r) => {
        fetchCalled = r;
      });
      const fetchFn: FetchFn = async () => {
        fetchCalled();
        return streamResponse("answer");
      };

      const instance = render(
        React.createElement(App, {
          conversation: ctx.conversation,
          config: ctx.config,
          mood: "ruthless",
          fetchFn,
        }),
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          exitOnCtrlC: false,
          interactive: true,
          patchConsole: false,
          maxFps: 60,
        },
      );

      try {
        // Type a user turn and submit. Wait for the fetch deferred to fire
        // (event-driven) rather than polling the conversation length on a
        // fixed-delay loop. Some Ink builds key off "data" boundaries to
        // distinguish typed characters from Enter, so we keep the two
        // writes separate but with no fixed wait between them.
        stdin.write("hello");
        await instance.waitUntilRenderFlush();
        stdin.write("\r");
        await fetchPromise;
        // Stream needs a render flush to commit the assistant message and
        // the conversation length transition (user + assistant).
        await waitFor(() => ctx.conversation.length >= 2, {
          timeoutMs: 1000,
          label: "conversation has user+assistant",
        });

        stdin.write("/model 26b");
        await instance.waitUntilRenderFlush();
        stdin.write("\r");
        // Slash-command model switch is synchronous app-state; one render
        // flush is enough before the unmount tears persistence down.
        await instance.waitUntilRenderFlush();

        instance.unmount();
        didUnmount = true;

        const loaded = await waitFor(
          () => {
            const s = loadSavedSession();
            return s?.model === MODEL_FALLBACK ? s : null;
          },
          { timeoutMs: 1000, label: "persisted MODEL_FALLBACK" },
        );

        expect(loaded).not.toBeNull();
        expect(loaded.model).toBe(MODEL_FALLBACK);
        expect(loaded.messages.map((m) => m.content)).toEqual([
          "hello",
          "answer",
        ]);
      } finally {
        if (!didUnmount) instance.unmount();
      }
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
      if (origXdg !== undefined) process.env.XDG_STATE_HOME = origXdg;
      else delete process.env.XDG_STATE_HOME;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("App can embed live deal desk chrome in the startup panel", () => {
    const ctx = makeCtx();
    const rendered = renderAppWithStdout(
      {
        conversation: ctx.conversation,
        config: ctx.config,
        mood: "ruthless",
        greeting: "Hello",
        showIntroChrome: true,
      },
      120,
      40,
    );

    expect(rendered).toContain("╭─ Tips");
    expect(rendered).toContain("Drexler Deal Desk");
    expect(rendered).toContain("◆ Briefcase boot");
    expect(rendered).toContain("Mood");
    expect(rendered).toContain("committee pulse: suspicious");
    expect(rendered).not.toContain("RUTHLESS");
    expect(rendered).toContain("▰▰");
    expect(rendered).toContain("BOARDROOM");
    expect(rendered).toContain("0 memos");
    expect(rendered.match(/╭─ Tips/g)?.length).toBe(1);
    expect(rendered.match(/Drexler Deal Desk/g)?.length).toBe(1);
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(120);
    }
  });

  test.each([
    [90, 30],
    [100, 30],
  ])(
    "App does not render automatic pet chrome on %d-column terminals",
    async (columns, rows) => {
      const origHome = process.env.HOME;
      const home = await mkdtemp(join(tmpdir(), "drexler-app-no-pet-"));
      try {
        process.env.HOME = home;
        const ctx = makeCtx();
        const rendered = renderAppWithStdout(
          {
            conversation: ctx.conversation,
            config: ctx.config,
            mood: "ruthless",
          },
          columns,
          rows,
        );

        expect(rendered).toContain("Drexler Deal Desk");
        expect(rendered).not.toContain("Drexler Pet Desk");
        expect(rendered).not.toContain("pet ");
        for (const row of rendered.split("\n")) {
          expect(displayWidth(row)).toBeLessThanOrEqual(columns);
        }
      } finally {
        if (origHome !== undefined) process.env.HOME = origHome;
        else delete process.env.HOME;
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test("App does not render a one-line pet ticker on tiny terminals by default", async () => {
    const origHome = process.env.HOME;
    const home = await mkdtemp(join(tmpdir(), "drexler-app-tiny-pet-"));
    try {
      process.env.HOME = home;
      const ctx = makeCtx();
      const rendered = renderAppWithStdout(
        {
          conversation: ctx.conversation,
          config: ctx.config,
          mood: "ruthless",
        },
        34,
        24,
      );

      expect(rendered).toContain("Drexler");
      expect(rendered).not.toContain("pet ");
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(34);
      }
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("App keeps the settled mascot dashboard after intro completes", async () => {
    const origHome = process.env.HOME;
    const home = await mkdtemp(join(tmpdir(), "drexler-app-dashboard-"));
    try {
      process.env.HOME = home;
      const ctx = makeCtx();
      const rendered = renderAppWithStdout(
        {
          conversation: ctx.conversation,
          config: ctx.config,
          mood: "ruthless",
          greeting: "Hello",
          showIntroChrome: true,
          introInitiallyDone: true,
        },
        128,
        40,
      );

      expect(rendered).toContain("╭─ Tips");
      expect(rendered).toContain("Drexler Deal Desk");
      expect(rendered).toContain("Drexler International");
      expect(rendered).toContain("RUTHLESS");
      expect(rendered).not.toContain("Drexler Pet Desk");
      expect(rendered.split("\n").length).toBeLessThanOrEqual(40);
      const rows = rendered.split("\n");
      const dashboardBottomIdx = rows.findIndex(
        (row) => row.startsWith("╰") && displayWidth(row) === 128,
      );
      expect(dashboardBottomIdx).toBeGreaterThan(0);
      expect(rows[dashboardBottomIdx - 1]).toContain("╰");
      expect(rows[dashboardBottomIdx - 1]).not.toMatch(/^│\s*│$/);
      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(128);
      }
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("App suppresses pet side panel during integrated intro to preserve startup geometry", async () => {
    const origHome = process.env.HOME;
    const home = await mkdtemp(join(tmpdir(), "drexler-app-intro-no-pet-"));
    try {
      process.env.HOME = home;
      const ctx = makeCtx();
      const rendered = renderAppWithStdout(
        {
          conversation: ctx.conversation,
          config: ctx.config,
          mood: "ruthless",
          greeting: "Hello",
          showIntroChrome: true,
        },
        128,
        40,
      );

      expect(rendered).toContain("╭─ Tips");
      expect(rendered).not.toContain("happy");
      for (const row of rendered.split("\n")) {
        expect(displayWidth(row)).toBeLessThanOrEqual(128);
      }
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each([
    [72, 30],
    [80, 30],
    [72, 31],
    [80, 31],
  ])("App suppresses startup panel at %dx%d", (columns, rows) => {
    const ctx = makeCtx();
    const rendered = renderAppWithStdout(
      {
        conversation: ctx.conversation,
        config: ctx.config,
        mood: "ruthless",
        greeting: "Hello",
        showIntroChrome: true,
      },
      columns,
      rows,
    );

    expect(rendered).not.toContain("╭─ Tips");
    expect(rendered).toContain("Drexler Deal Desk");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(columns);
    }
  });
});

describe("historyNavStep", () => {
  test("up-arrow from empty draft snapshots empty and loads newest entry", () => {
    const result = historyNavStep(
      { historyIdx: null, draft: { value: "", cursor: 0 }, historyDraft: null },
      ["a", "b", "c"],
      "up",
    );
    expect(result.historyIdx).toBe(2);
    expect(result.draft).toEqual({ value: "c", cursor: 1 });
    expect(result.historyDraft).toEqual({ value: "", cursor: 0 });
  });

  test("up-arrow snapshots non-empty unsent draft", () => {
    const result = historyNavStep(
      { historyIdx: null, draft: { value: "typing", cursor: 6 }, historyDraft: null },
      ["a", "b"],
      "up",
    );
    expect(result.historyDraft).toEqual({ value: "typing", cursor: 6 });
    expect(result.draft.value).toBe("b");
  });

  test("down-arrow past newest restores snapshot", () => {
    const result = historyNavStep(
      {
        historyIdx: 1,
        draft: { value: "b", cursor: 1 },
        historyDraft: { value: "typing", cursor: 6 },
      },
      ["a", "b"],
      "down",
    );
    expect(result.historyIdx).toBeNull();
    expect(result.draft).toEqual({ value: "typing", cursor: 6 });
    expect(result.historyDraft).toBeNull();
  });

  test("down-arrow past newest with no snapshot clears", () => {
    const result = historyNavStep(
      { historyIdx: 0, draft: { value: "a", cursor: 1 }, historyDraft: null },
      ["a"],
      "down",
    );
    expect(result.historyIdx).toBeNull();
    expect(result.draft).toEqual({ value: "", cursor: 0 });
  });

  test("subsequent up-arrows preserve original snapshot", () => {
    const first = historyNavStep(
      { historyIdx: null, draft: { value: "typed", cursor: 5 }, historyDraft: null },
      ["a", "b", "c"],
      "up",
    );
    const second = historyNavStep(first, ["a", "b", "c"], "up");
    expect(second.historyDraft).toEqual({ value: "typed", cursor: 5 });
    expect(second.draft.value).toBe("b");
  });

  test("up-arrow on empty history is a no-op", () => {
    const state = {
      historyIdx: null,
      draft: { value: "x", cursor: 1 },
      historyDraft: null,
    };
    expect(historyNavStep(state, [], "up")).toEqual(state);
  });
});

describe("makeDebouncer (P2)", () => {
  test("collapses rapid schedules into one fire", async () => {
    const d = makeDebouncer(20);
    let count = 0;
    d.schedule(() => count++);
    d.schedule(() => count++);
    d.schedule(() => count++);
    expect(d.hasPending()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(count).toBe(1);
    expect(d.hasPending()).toBe(false);
  });

  test("cancel suppresses pending fire", async () => {
    const d = makeDebouncer(20);
    let count = 0;
    d.schedule(() => count++);
    expect(d.hasPending()).toBe(true);
    d.cancel();
    expect(d.hasPending()).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(0);
  });

  test("each schedule uses the latest fn", async () => {
    const d = makeDebouncer(20);
    let stale = 0;
    let fresh = 0;
    d.schedule(() => stale++);
    d.schedule(() => fresh++);
    await new Promise((r) => setTimeout(r, 60));
    expect(stale).toBe(0);
    expect(fresh).toBe(1);
  });

  test("after fire, next schedule starts a fresh window", async () => {
    const d = makeDebouncer(20);
    let count = 0;
    d.schedule(() => count++);
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(1);
    d.schedule(() => count++);
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(2);
  });
});

describe("replaceExitTimer (B5)", () => {
  test("second call cancels first timer; only the latest fn fires", async () => {
    const ref: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    let firstCount = 0;
    let secondCount = 0;
    replaceExitTimer(ref, () => firstCount++, 30);
    replaceExitTimer(ref, () => secondCount++, 30);
    await new Promise((r) => setTimeout(r, 80));
    expect(firstCount).toBe(0);
    expect(secondCount).toBe(1);
    expect(ref.current).toBeNull();
  });

  test("clears ref after the timer fires", async () => {
    const ref: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    replaceExitTimer(ref, () => undefined, 10);
    expect(ref.current).not.toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(ref.current).toBeNull();
  });

  test("first call assigns a handle when ref starts null", () => {
    const ref: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    replaceExitTimer(ref, () => undefined, 10_000);
    expect(ref.current).not.toBeNull();
    clearTimeout(ref.current as ReturnType<typeof setTimeout>);
  });
});
