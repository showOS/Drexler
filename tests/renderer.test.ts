import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import {
  banner,
  createAccentBarWriter,
  inputBoxBottom,
  inputBoxTop,
  pickThinkingLine,
  prompt,
  renderMarkdown,
  startSpinner,
  statusLine,
  welcomeBox,
} from "../src/renderer.ts";

chalk.level = 3;

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderer", () => {
  test("banner uses block characters and is multi-line", () => {
    const stripped = stripAnsi(banner());
    expect(stripped).toContain("█");
    expect(stripped.split("\n").length).toBeGreaterThanOrEqual(6);
  });

  test("welcomeBox includes greeting and brand text", () => {
    const out = stripAnsi(welcomeBox("Drexler convene meeting."));
    expect(out).toContain("Welcome to");
    expect(out).toContain("Drexler International");
    expect(out).toContain("Drexler convene meeting.");
  });

  test("prompt contains '❯'", () => {
    expect(stripAnsi(prompt())).toContain("❯");
  });

  test("inputBoxTop and inputBoxBottom use box-drawing chars", () => {
    expect(stripAnsi(inputBoxTop())).toMatch(/^╭─+╮$/);
    expect(stripAnsi(inputBoxBottom())).toMatch(/^╰─+╯$/);
  });

  test("statusLine includes message count", () => {
    const out = stripAnsi(statusLine("google/gemma-4-31b-it", 3));
    expect(out).toContain("3 messages");
  });

  test("statusLine excludes model name", () => {
    const out = stripAnsi(statusLine("google/gemma-4-31b-it", 3));
    expect(out).not.toContain("google/gemma-4-31b-it");
  });

  test("statusLine handles singular message", () => {
    const out = stripAnsi(statusLine("m", 1));
    expect(out).toContain("1 message");
    expect(out).not.toContain("1 messages");
  });

  test("V14: renderMarkdown handles bold text", () => {
    const out = renderMarkdown("**bold word**");
    expect(out).toContain("bold word");
  });

  test("V14: renderMarkdown handles fenced code", () => {
    const out = renderMarkdown("```js\nlet x = 1;\n```");
    expect(out).toContain("let x");
  });

  test("V14: renderMarkdown handles inline code", () => {
    const out = renderMarkdown("use `bun test`");
    expect(out).toContain("bun test");
  });
});

describe("createAccentBarWriter", () => {
  test("prefixes each output line with vertical bar", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    try {
      const w = createAccentBarWriter();
      w.write("hello\nworld\n");
      w.end();
    } finally {
      process.stdout.write = origWrite;
    }
    const all = stripAnsi(chunks.join(""));
    const lines = all.split("\n");
    // First two lines should start with "│ "
    expect(lines[0]?.startsWith("│ ")).toBe(true);
    expect(lines[1]?.startsWith("│ ")).toBe(true);
    expect(lines[0]).toContain("hello");
    expect(lines[1]).toContain("world");
  });

  test("handles tokens split mid-word", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    try {
      const w = createAccentBarWriter();
      w.write("Drex");
      w.write("ler ");
      w.write("speak.");
      w.end();
    } finally {
      process.stdout.write = origWrite;
    }
    const all = stripAnsi(chunks.join(""));
    expect(all).toContain("│ Drexler speak.");
  });

  test("end() emits trailing newline if last char wasn't \\n", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    try {
      const w = createAccentBarWriter();
      w.write("no newline at end");
      w.end();
    } finally {
      process.stdout.write = origWrite;
    }
    const all = stripAnsi(chunks.join(""));
    expect(all.endsWith("\n")).toBe(true);
  });

  test("end() does not emit extra newline when content ended with \\n", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    try {
      const w = createAccentBarWriter();
      w.write("ends with newline\n");
      w.end();
    } finally {
      process.stdout.write = origWrite;
    }
    const all = stripAnsi(chunks.join(""));
    // Content already had its own \n. end() should not double up.
    expect(all.match(/\n$/)).not.toBeNull();
    expect(all.match(/\n\n$/)).toBeNull();
  });
});

describe("pickThinkingLine", () => {
  test("returns a non-empty string", () => {
    for (let i = 0; i < 10; i++) {
      const line = pickThinkingLine();
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe("startSpinner non-TTY fallback", () => {
  test("prints single-line label when stdout is not TTY", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    (process.stdout as { isTTY?: boolean }).isTTY = false;
    try {
      const s = startSpinner("test label");
      s.stop();
    } finally {
      process.stdout.write = origWrite;
      (process.stdout as { isTTY?: boolean }).isTTY = origIsTTY;
    }
    const all = stripAnsi(chunks.join(""));
    expect(all).toContain("test label");
    expect(all.includes("\n")).toBe(true);
  });
});
