import { describe, expect, test } from "bun:test";
import { renderToString, useStdout } from "ink";
import React from "react";
import { dispatch } from "../src/commands.ts";
import { Conversation } from "../src/conversation.ts";
import type { FetchFn } from "../src/llm.ts";
import { App } from "../src/ui/App.tsx";
import {
  nextTranscriptScrollOffset,
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
