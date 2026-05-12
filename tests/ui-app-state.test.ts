import { describe, expect, test } from "bun:test";
import { renderToString, useStdout } from "ink";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { dispatch } from "../src/commands.ts";
import { Conversation } from "../src/conversation.ts";
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
import { MODEL_PRIMARY, type Config } from "../src/types.ts";

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
