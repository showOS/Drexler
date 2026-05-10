import { describe, expect, test } from "bun:test";
import { parseBlocks, tokenizeInline } from "../src/ui/MarkdownBody.tsx";

describe("tokenizeInline", () => {
  test("returns plain text untouched", () => {
    expect(tokenizeInline("hello world")).toEqual([{ text: "hello world" }]);
  });

  test("parses bold with double-asterisks", () => {
    expect(tokenizeInline("a **bold** word")).toEqual([
      { text: "a " },
      { text: "bold", bold: true },
      { text: " word" },
    ]);
  });

  test("parses bold with double-underscores", () => {
    expect(tokenizeInline("__strong__")).toEqual([
      { text: "strong", bold: true },
    ]);
  });

  test("parses inline code", () => {
    expect(tokenizeInline("run `npm test` now")).toEqual([
      { text: "run " },
      { text: "npm test", code: true },
      { text: " now" },
    ]);
  });

  test("parses link", () => {
    expect(tokenizeInline("[docs](https://example.com)")).toEqual([
      { text: "docs", link: "https://example.com" },
    ]);
  });

  test("parses link with parens in URL (wikipedia-style)", () => {
    expect(
      tokenizeInline("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))"),
    ).toEqual([
      { text: "wiki", link: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    ]);
  });

  test("treats unmatched marker as literal", () => {
    expect(tokenizeInline("a ** unfinished")).toEqual([
      { text: "a ** unfinished" },
    ]);
  });

  test("preserves bold across nested italic markers", () => {
    const tokens = tokenizeInline("**Threat:** rest");
    expect(tokens[0]).toEqual({ text: "Threat:", bold: true });
    expect(tokens[1]?.text).toBe(" rest");
  });
});

describe("parseBlocks", () => {
  test("splits paragraph and bullets", () => {
    const blocks = parseBlocks("intro\n\n* one\n* two");
    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.kind).toBe("para");
    expect(blocks[1]?.kind).toBe("blank");
    expect(blocks[2]?.kind).toBe("bullet");
    expect(blocks[3]?.kind).toBe("bullet");
  });

  test("identifies headings by hash level", () => {
    const blocks = parseBlocks("# big\n## smaller");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, line: "big" });
    expect(blocks[1]).toMatchObject({ kind: "heading", level: 2, line: "smaller" });
  });

  test("captures fenced code block contents", () => {
    const blocks = parseBlocks("```ts\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "code",
      lang: "ts",
      lines: ["const x = 1;"],
    });
  });

  test("recognizes ordered list markers", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks[0]).toMatchObject({ kind: "bullet", marker: "1." });
    expect(blocks[1]).toMatchObject({ kind: "bullet", marker: "2." });
  });

  test("recognizes hr lines", () => {
    expect(parseBlocks("---")[0]?.kind).toBe("hr");
    expect(parseBlocks("***")[0]?.kind).toBe("hr");
  });

  test("groups consecutive blockquote lines", () => {
    const blocks = parseBlocks("> first\n> second");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "quote", lines: ["first", "second"] });
  });
});
