import { describe, expect, test } from "bun:test";
import { Text, renderToString } from "ink";
import React from "react";
import {
  TranscriptViewport,
  type TranscriptViewportItem,
} from "../src/ui/TranscriptViewport.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderViewport(
  props: React.ComponentProps<typeof TranscriptViewport>,
): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: React.createElement(TranscriptViewport, props),
    }),
  ).replace(ANSI_RE, "");
}

const items: TranscriptViewportItem[] = [
  { id: 1, role: "user", content: "memo 1" },
  { id: 2, role: "assistant", content: "memo 2" },
  { id: 3, role: "user", content: "memo 3" },
  { id: 4, role: "assistant", content: "memo 4" },
  { id: 5, role: "user", content: "memo 5" },
  { id: 6, role: "assistant", content: "memo 6" },
];

describe("TranscriptViewport", () => {
  test("renders the latest transcript items and a scrollback indicator", () => {
    const rendered = renderViewport({
      items,
      maxRows: 7,
      cols: 60,
    });

    expect(rendered).toContain("earlier transcript items hidden");
    expect(rendered).toContain("memo 5");
    expect(rendered).toContain("memo 6");
    expect(rendered).not.toContain("memo 1");
    expect(rendered).not.toContain("memo 2");
  });

  test("demarcates user and Drexler turns with distinct transcript blocks", () => {
    const rendered = renderViewport({
      items: [
        { id: "u", role: "user", content: "Need covenant readout." },
        {
          id: "a",
          role: "assistant",
          content: "Covenant cushion acceptable. Watch liquidity.",
        },
      ],
      maxRows: 8,
      cols: 72,
    });

    expect(rendered).toContain("╭─ YOU");
    expect(rendered).toContain("incoming memo");
    expect(rendered).toContain("›  Need covenant readout.");
    expect(rendered).toContain("╭─ DREXLER");
    expect(rendered).toContain("response ledger");
    expect(rendered).toContain("│  Covenant cushion acceptable.");
  });

  test("supports compact mode with one-line transcript rows", () => {
    const rendered = renderViewport({
      items,
      maxRows: 4,
      cols: 42,
      compact: true,
    });

    expect(rendered).toContain("↑ 3 earlier");
    expect(rendered).toContain("YOU › memo 5");
    expect(rendered).toContain("DREXLER ◆ memo 6");
    expect(rendered).not.toContain("\nYOU\n");
  });

  test("clips default item rendering to narrow columns", () => {
    const width = 22;
    const rendered = renderViewport({
      items: [
        {
          id: "wide",
          role: "assistant",
          content: "漢字かな交じり文 with a very long memo line",
        },
      ],
      maxRows: 8,
      cols: width,
    });

    expect(rendered).toContain("…");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("windows children from the bottom by default", () => {
    const rendered = renderViewport({
      maxRows: 3,
      cols: 50,
      children: [
        React.createElement(Text, { key: "a" }, "child 1"),
        React.createElement(Text, { key: "b" }, "child 2"),
        React.createElement(Text, { key: "c" }, "child 3"),
        React.createElement(Text, { key: "d" }, "child 4"),
      ],
    });

    expect(rendered).toContain("2 earlier transcript items hidden");
    expect(rendered).toContain("child 3");
    expect(rendered).toContain("child 4");
    expect(rendered).not.toContain("child 1");
  });

  test("scrollOffset exposes older transcript with newer indicator", () => {
    const rendered = renderViewport({
      items,
      maxRows: 9,
      cols: 60,
      scrollOffset: 2,
    });

    expect(rendered).toContain("newer transcript items hidden");
    expect(rendered).toContain("memo 3");
    expect(rendered).toContain("memo 4");
    expect(rendered).not.toContain("memo 6");
  });
});
