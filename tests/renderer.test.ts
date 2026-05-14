import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import {
  banner,
  createAccentBarWriter,
  inputBoxBottom,
  inputBoxTop,
  pickLayout,
  pickThinkingLine,
  prompt,
  renderMarkdown,
  startSpinner,
  statusLine,
  tipsList,
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

  test("welcomeBox includes startup tips inside the main box", () => {
    const out = stripAnsi(welcomeBox("Drexler convene meeting.", 160));
    const tipsLine = out.split("\n").find((line) => line.includes("Tips for getting started"));
    expect(tipsLine).toBeDefined();
    expect(out).toContain("1. Ask about LMEs");
    expect(tipsLine?.match(/│/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("prompt contains '❯'", () => {
    expect(stripAnsi(prompt())).toContain("❯");
  });

  test("inputBoxTop and inputBoxBottom use box-drawing chars", () => {
    expect(stripAnsi(inputBoxTop())).toMatch(/^╭─+╮$/);
    expect(stripAnsi(inputBoxBottom())).toMatch(/^╰─+╯$/);
  });

  test("statusLine includes message count", () => {
    const out = stripAnsi(statusLine(3));
    expect(out).toContain("3 messages");
  });

  test("statusLine handles singular message", () => {
    const out = stripAnsi(statusLine(1));
    expect(out).toContain("1 message");
    expect(out).not.toContain("1 messages");
  });

  test("V14: renderMarkdown handles bold text", () => {
    const out = renderMarkdown("**bold word**");
    expect(out).toContain("bold word");
  });

  test("V14: renderMarkdown handles fenced code", () => {
    // Strip ANSI: under a TTY (or FORCE_COLOR) cli-highlight injects color
    // escapes between tokens, so a raw `toContain("let x")` would split on
    // the boundary between the highlighted `let` keyword and ` x`.
    const out = stripAnsi(renderMarkdown("```js\nlet x = 1;\n```"));
    expect(out).toContain("let x");
  });

  test("V14: renderMarkdown handles inline code", () => {
    const out = renderMarkdown("use `bun test`");
    expect(out).toContain("bun test");
  });

  test("renderMarkdown handles headings", () => {
    const out = stripAnsi(renderMarkdown("# Drexler memo\n\nbody"));
    expect(out).toContain("Drexler memo");
    expect(out).toContain("body");
  });

  test("renderMarkdown handles unordered list items", () => {
    const out = stripAnsi(renderMarkdown("- alpha\n- beta\n- gamma"));
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("gamma");
  });

  test("renderMarkdown handles blockquote", () => {
    const out = stripAnsi(renderMarkdown("> Drexler quoted"));
    expect(out).toContain("Drexler quoted");
  });

  test("renderMarkdown handles links (preserves link text)", () => {
    const out = stripAnsi(renderMarkdown("[click](https://example.com)"));
    expect(out).toContain("click");
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

describe("tipsList", () => {
  test("renders numbered list with 4 tips and header", () => {
    const out = stripAnsi(tipsList());
    expect(out).toMatch(/Tips for getting started/);
    expect(out).toMatch(/^\s*1\./m);
    expect(out).toMatch(/^\s*2\./m);
    expect(out).toMatch(/^\s*3\./m);
    expect(out).toMatch(/^\s*4\./m);
    expect(out).toContain("/help");
    expect(out).toContain("Tab");
    expect(out).toContain("ESC");
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

describe("startSpinner TTY mode", () => {
  test("hides cursor on start, shows on stop, writes label and frame", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    (process.stdout as { isTTY?: boolean }).isTTY = true;
    try {
      const s = startSpinner("computing");
      s.stop();
    } finally {
      process.stdout.write = origWrite;
      (process.stdout as { isTTY?: boolean }).isTTY = origIsTTY;
    }
    const all = chunks.join("");
    expect(all).toContain("\x1b[?25l"); // cursor hide
    expect(all).toContain("\x1b[?25h"); // cursor show
    expect(stripAnsi(all)).toContain("computing");
  });

  test("stop() clears the line so next output starts fresh", () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
    process.stdout.write = ((c: string) => {
      chunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    (process.stdout as { isTTY?: boolean }).isTTY = true;
    try {
      const s = startSpinner("x");
      s.stop();
    } finally {
      process.stdout.write = origWrite;
      (process.stdout as { isTTY?: boolean }).isTTY = origIsTTY;
    }
    const all = chunks.join("");
    expect(all).toContain("\r\x1b[2K"); // CR + clear-line on stop
  });
});

describe("responsive layout", () => {
  test("pickLayout returns wide for >= 80 cols", () => {
    expect(pickLayout(120)).toBe("wide");
    expect(pickLayout(80)).toBe("wide");
  });

  test("pickLayout returns narrow for 60..79", () => {
    expect(pickLayout(70)).toBe("narrow");
    expect(pickLayout(60)).toBe("narrow");
    expect(pickLayout(79)).toBe("narrow");
  });

  test("pickLayout returns very-narrow for < 60", () => {
    expect(pickLayout(40)).toBe("very-narrow");
    expect(pickLayout(59)).toBe("very-narrow");
  });

  test("welcomeBox(narrow) places 'Welcome to' on different visible line than mascot glyph", () => {
    const out = stripAnsi(welcomeBox("hi", 70));
    const lines = out.split("\n");
    const welcomeIdx = lines.findIndex((l) => l.includes("Welcome to"));
    const mascotIdx = lines.findIndex((l) => l.includes("◆"));
    expect(welcomeIdx).toBeGreaterThanOrEqual(0);
    expect(mascotIdx).toBeGreaterThanOrEqual(0);
    expect(welcomeIdx).not.toBe(mascotIdx);
  });

  test("welcomeBox(very-narrow) drops mascot entirely", () => {
    const out = stripAnsi(welcomeBox("hi", 50));
    expect(out).not.toContain("◆");
    expect(out).not.toContain("╔════╗");
  });

  test("inputBoxTop(40) matches narrowed bracket regex", () => {
    expect(stripAnsi(inputBoxTop(40))).toMatch(/^╭─{36,38}╮$/);
  });

  test("inputBoxTop() with no arg still 64 wide (existing test preserved)", () => {
    expect(stripAnsi(inputBoxTop())).toMatch(/^╭─+╮$/);
    expect(stripAnsi(inputBoxTop()).length).toBe(64);
  });

  test("statusLine(3, 'very-narrow') drops witticism quotes", () => {
    const out = stripAnsi(statusLine(3, "very-narrow"));
    expect(out).not.toContain('"');
    expect(out).toContain("3 message");
  });
});
