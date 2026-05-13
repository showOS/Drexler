import { describe, expect, test } from "bun:test";
import { Text, renderToString } from "ink";
import React from "react";
import {
  estimateTranscriptRows,
  TranscriptViewport,
  wrappedTranscriptLines,
  type TranscriptViewportItem,
} from "../src/ui/TranscriptViewport.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderViewport(props: React.ComponentProps<typeof TranscriptViewport>): string {
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

    expect(rendered).toMatch(/earlier .* PageUp scrollback/);
    expect(rendered).toContain("items hidden");
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
    expect(rendered).not.toContain("incoming memo");
    expect(rendered).toContain("│ › Need covenant readout.");
    expect(rendered).toContain("╭─ DREXLER");
    expect(rendered).not.toContain("response ledger");
    expect(rendered).toContain("Covenant cushion acceptable.");
    expect(rendered).toContain("╯");
    const userBody = rendered.split("\n").find((row) => row.includes("Need covenant readout."));
    const drexlerBody = rendered
      .split("\n")
      .find((row) => row.includes("Covenant cushion acceptable."));
    expect(userBody?.indexOf("Need")).toBe(drexlerBody?.indexOf("Covenant"));
    expect(drexlerBody?.startsWith("│ ◆ ")).toBe(true);
    expect(drexlerBody?.endsWith(" │")).toBe(true);
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(72);
    }
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

  test("wraps default item rendering to narrow columns", () => {
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

    expect(rendered).toContain("漢字かな交じり文");
    expect(rendered).toContain("very");
    expect(rendered).toContain("memo");
    expect(rendered).not.toContain("…");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("wraps long Drexler and user lines instead of cutting them off", () => {
    const width = 38;
    const rendered = renderViewport({
      items: [
        {
          id: "user-long",
          role: "user",
          content: "Please explain why the covenant math still matters after refinancing.",
        },
        {
          id: "assistant-long",
          role: "assistant",
          content:
            "Covenant math matters because liquidity tells the truth before management does.",
        },
      ],
      maxRows: 14,
      cols: width,
    });

    expect(rendered).toContain("│ › Please explain why the covenant");
    expect(rendered).toContain("math still matters after");
    expect(rendered).toContain("Covenant math matters because");
    expect(rendered).toContain("liquidity tells the truth");
    expect(rendered).not.toContain("…");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("unwraps assistant markdown fences used only for formatted prose", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-markdown",
          role: "assistant",
          content:
            "Drexler not chef.\n\n```markdown\n1. Procure 80/20 beef.\n2. Sear on high heat.\n```\n\nIf burger is mid, Drexler initiate hostile takeover of BBQ.",
        },
      ],
      maxRows: 12,
      cols: 92,
    });

    expect(rendered).toContain("│ ◆ Drexler not chef.");
    expect(rendered).toContain("1. Procure 80/20 beef.");
    expect(rendered).toContain("2. Sear on high heat.");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("markdown");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(92);
    }
  });

  test("trims trailing blank assistant rows without removing internal paragraph gaps", () => {
    const clean = renderViewport({
      items: [
        {
          id: "assistant-clean",
          role: "assistant",
          content: "Drexler has one memo.",
        },
      ],
      maxRows: 8,
      cols: 72,
    });
    const withTrailingBlanks = renderViewport({
      items: [
        {
          id: "assistant-trailing",
          role: "assistant",
          content: "Drexler has one memo.\n\n",
        },
      ],
      maxRows: 8,
      cols: 72,
    });
    const withInternalBlank = renderViewport({
      items: [
        {
          id: "assistant-internal",
          role: "assistant",
          content: "First memo.\n\nSecond memo.",
        },
      ],
      maxRows: 8,
      cols: 72,
    });

    expect(withTrailingBlanks.split("\n")).toHaveLength(clean.split("\n").length);
    expect(withTrailingBlanks).toContain("Drexler has one memo.");
    expect(withInternalBlank.split("\n").length).toBeGreaterThan(clean.split("\n").length);
    expect(withInternalBlank).toContain("First memo.");
    expect(withInternalBlank).toContain("Second memo.");
  });

  test("unwraps assistant code fences without leaking language tags", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-code",
          role: "assistant",
          content:
            'Specify asset class.\n\n```python\nprint("Synergy achieved.")\n```\n\nCode must deliver ROI.',
        },
      ],
      maxRows: 12,
      cols: 92,
    });

    expect(rendered).toContain("│ ◆ Specify asset class.");
    expect(rendered).toContain('┃ print("Synergy achieved.")');
    expect(rendered).toContain("Code must deliver ROI.");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("python");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(92);
    }
  });

  test("unwraps multiple tilde and CRLF fences in assistant display", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-mixed-fences",
          role: "assistant",
          content:
            'First memo\r\n~~~md\r\n- Raise fee\r\n~~~\r\nThen code\r\n```\r\nconst fee = "absurd";\r\n```',
        },
      ],
      maxRows: 14,
      cols: 92,
    });

    expect(rendered).toContain("First memo");
    expect(rendered).toContain("- Raise fee");
    expect(rendered).toContain("Then code");
    expect(rendered).toContain('┃ const fee = "absurd";');
    expect(rendered).not.toContain("~~~");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("md");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(92);
    }
  });

  test("hides an unclosed assistant fence marker while preserving content", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-unclosed-fence",
          role: "assistant",
          content: "Drexler draft:\n```ts\nconst memo = true;",
        },
      ],
      maxRows: 8,
      cols: 72,
    });

    expect(rendered).toContain("Drexler draft:");
    expect(rendered).toContain("┃ const memo = true;");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("ts");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(72);
    }
  });

  test("compact assistant preview skips leading fences and blank rows", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "compact-fence",
          role: "assistant",
          content: "\n```markdown\n1. Alpha memo\n2. Beta memo\n```",
        },
      ],
      maxRows: 2,
      cols: 42,
      compact: true,
    });

    expect(rendered).toContain("DREXLER ◆ 1. Alpha memo");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("markdown");
  });

  test("expands assistant tabs before width fitting", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-tabbed-code",
          role: "assistant",
          content: '```python\nif deal:\n\tprint("fees")\n```',
        },
      ],
      maxRows: 8,
      cols: 36,
    });

    expect(rendered).toContain('┃   print("fees")');
    expect(rendered).not.toContain("\t");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(36);
    }
  });

  test("renders multi-line fenced code as a distinct in-card block", () => {
    const rendered = renderViewport({
      items: [
        {
          id: "assistant-fizzbuzz",
          role: "assistant",
          content:
            '```python\nfor i in range(1, 101):\n  if i % 3 == 0 and i % 5 == 0: print("FizzBuzz")\n  elif i % 3 == 0: print("Fizz")\n  elif i % 5 == 0: print("Buzz")\n  else: print(i)\n```\n\nDrexler check code for leaks.',
        },
      ],
      maxRows: 14,
      cols: 118,
    });

    expect(rendered).toContain("│ ◆ ┃ for i in range(1, 101):");
    expect(rendered).toContain('│   ┃   if i % 3 == 0 and i % 5 == 0: print("FizzBuzz")');
    expect(rendered).toContain("Drexler check code for leaks.");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("python");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(118);
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

    expect(rendered).toContain("(2 items hidden)");
    expect(rendered).toContain("child 3");
    expect(rendered).toContain("child 4");
    expect(rendered).not.toContain("child 1");
  });

  test("drops indicators before exceeding maxRows with a full card", () => {
    const rendered = renderViewport({
      items: [
        { id: "old", role: "user", content: "old memo" },
        { id: "new", role: "assistant", content: "new memo" },
      ],
      maxRows: 3,
      cols: 44,
    });

    const rows = rendered.split("\n").filter(Boolean);
    expect(rows).toHaveLength(3);
    expect(rendered).not.toContain("earlier");
    expect(rendered).toContain("new memo");
  });

  test("uses compact fallback when maxRows is below framed-card height", () => {
    const rendered = renderViewport({
      items: [{ id: "new", role: "assistant", content: "new memo" }],
      maxRows: 2,
      cols: 44,
    });

    const rows = rendered.split("\n").filter(Boolean);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rendered).toContain("DREXLER ◆ new memo");
    expect(rendered).not.toContain("╭─ DREXLER");
  });

  test("scrollOffset exposes older transcript rows", () => {
    const rendered = renderViewport({
      items,
      maxRows: 9,
      cols: 60,
      scrollOffset: 8,
    });

    expect(rendered).toContain("memo 1");
    expect(rendered).toContain("memo 2");
    expect(rendered).toContain("memo 3");
    expect(rendered).not.toContain("memo 6");
  });

  test("clips a single oversize assistant response to maxRows with truncation hint", () => {
    const longContent = Array.from({ length: 60 }, (_, i) => `memo line ${i + 1}`).join("\n");
    const rendered = renderViewport({
      items: [{ id: "huge", role: "assistant", content: longContent }],
      maxRows: 8,
      cols: 60,
    });
    const rows = rendered.split("\n").filter(Boolean);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rendered).toMatch(/\.\.\. \d+ lines? earlier — PageUp scrollback to read/);
    expect(rendered).toContain("memo line 55");
    expect(rendered).not.toContain("memo line 1");
  });

  test("scrollOffset can page through a single oversize assistant response", () => {
    const longContent = Array.from({ length: 60 }, (_, i) => `memo line ${i + 1}`).join("\n");
    const rendered = renderViewport({
      items: [{ id: "huge", role: "assistant", content: longContent }],
      maxRows: 8,
      cols: 60,
      scrollOffset: 56,
    });

    const rows = rendered.split("\n").filter(Boolean);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rendered).toContain("memo line 1");
    expect(rendered).toContain("memo line 2");
    expect(rendered).toMatch(/\.\.\. \d+ lines? newer — PageDown newer to read/);
    expect(rendered).toMatch(/newer .* PageDown newer/);
  });

  test("scroll indicator reports rows in addition to item counts", () => {
    const tall = {
      id: "tall",
      role: "assistant" as const,
      content: Array.from({ length: 20 }, (_, i) => `tall line ${i + 1}`).join("\n"),
    };
    const short = [
      { id: "s1", role: "user" as const, content: "one" },
      { id: "s2", role: "assistant" as const, content: "two" },
    ];
    const rendered = renderViewport({
      items: [tall, ...short],
      maxRows: 10,
      cols: 60,
    });
    expect(rendered).toMatch(/\d+ lines? earlier/);
    expect(rendered).toContain("PageUp scrollback");
  });
});

describe("wrappedTranscriptLines cache (P10)", () => {
  test("returns same array identity for identical (item, width) calls", () => {
    const item: TranscriptViewportItem = {
      id: "cache-test",
      role: "assistant",
      content: "alpha beta gamma delta epsilon zeta eta theta",
    };
    const first = wrappedTranscriptLines(item, 20);
    const second = wrappedTranscriptLines(item, 20);
    expect(second).toBe(first);
  });

  test("returns distinct arrays for different widths", () => {
    const item: TranscriptViewportItem = {
      id: "width-test",
      role: "assistant",
      content: "alpha beta gamma delta epsilon zeta eta theta",
    };
    const narrow = wrappedTranscriptLines(item, 10);
    const wide = wrappedTranscriptLines(item, 40);
    expect(wide).not.toBe(narrow);
  });

  test("returns distinct entries for different items even with identical content", () => {
    const a: TranscriptViewportItem = {
      id: "a",
      role: "assistant",
      content: "same content",
    };
    const b: TranscriptViewportItem = {
      id: "b",
      role: "assistant",
      content: "same content",
    };
    const fromA = wrappedTranscriptLines(a, 20);
    const fromB = wrappedTranscriptLines(b, 20);
    expect(fromA).not.toBe(fromB);
    expect(fromA.map((l) => l.text)).toEqual(fromB.map((l) => l.text));
  });

  test("LRU-evicts oldest entry once per-item cache exceeds bound", () => {
    const item: TranscriptViewportItem = {
      id: "lru-test",
      role: "assistant",
      content: "alpha beta gamma delta epsilon zeta eta theta",
    };
    // MAX_WIDTHS_PER_ITEM = 4. Fill with widths 10..13.
    const first = wrappedTranscriptLines(item, 10);
    wrappedTranscriptLines(item, 11);
    wrappedTranscriptLines(item, 12);
    wrappedTranscriptLines(item, 13);
    // Inserting a fifth (width 14) must evict the oldest (width 10).
    wrappedTranscriptLines(item, 14);
    // Width 10 should now be recomputed → fresh array identity.
    const refetched = wrappedTranscriptLines(item, 10);
    expect(refetched).not.toBe(first);
    // Width 14 should still be cached (most recent).
    const w14a = wrappedTranscriptLines(item, 14);
    const w14b = wrappedTranscriptLines(item, 14);
    expect(w14b).toBe(w14a);
  });

  test("LRU-get bumps recency: re-fetching protects against eviction", () => {
    const item: TranscriptViewportItem = {
      id: "lru-bump-test",
      role: "assistant",
      content: "alpha beta gamma delta",
    };
    const w10 = wrappedTranscriptLines(item, 10);
    wrappedTranscriptLines(item, 11);
    wrappedTranscriptLines(item, 12);
    wrappedTranscriptLines(item, 13);
    // Bump width 10 to most-recent by re-fetching.
    expect(wrappedTranscriptLines(item, 10)).toBe(w10);
    // Adding a fifth distinct width must now evict width 11 (next oldest), NOT 10.
    wrappedTranscriptLines(item, 14);
    expect(wrappedTranscriptLines(item, 10)).toBe(w10);
  });

  test("invalidates wraps when a reused item object changes content", () => {
    const item: TranscriptViewportItem = {
      id: "mutated-wrap",
      role: "assistant",
      content: "alpha beta",
    };
    const first = wrappedTranscriptLines(item, 20);

    (item as { content: string }).content = "omega delta";
    const second = wrappedTranscriptLines(item, 20);

    expect(second).not.toBe(first);
    expect(second.map((line) => line.text).join("\n")).toContain("omega");
    expect(second.map((line) => line.text).join("\n")).not.toContain("alpha");
  });

  test("invalidates row estimates when a reused item object changes content", () => {
    const item: TranscriptViewportItem = {
      id: "mutated-rows",
      role: "assistant",
      content: "short",
    };
    const first = estimateTranscriptRows([item], false, 60);

    (item as { content: string }).content = "line 1\nline 2\nline 3\nline 4";
    const second = estimateTranscriptRows([item], false, 60);

    expect(second).toBeGreaterThan(first);
  });

  test("rendering reflects same-object content mutation instead of stale cache", () => {
    const item: TranscriptViewportItem = {
      id: "mutated-render",
      role: "assistant",
      content: "first memo",
    };
    expect(renderViewport({ items: [item], maxRows: 8, cols: 72 })).toContain("first memo");

    (item as { content: string }).content = "second memo";
    const rendered = renderViewport({ items: [item], maxRows: 8, cols: 72 });

    expect(rendered).toContain("second memo");
    expect(rendered).not.toContain("first memo");
  });
});
