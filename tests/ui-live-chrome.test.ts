import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { render, renderToString } from "ink";
import React from "react";
import { Conversation } from "../src/conversation.ts";
import { MODEL_PRIMARY, type Config } from "../src/types.ts";
import { App } from "../src/ui/App.tsx";
import { displayWidth } from "../src/ui/graphemes.ts";
import { StreamingMessage } from "../src/ui/Message.tsx";
import { Spinner } from "../src/ui/Spinner.tsx";
import {
  pickSynergyEvent,
  SynergyEvent,
  SYNERGY_EVENTS,
  SYNERGY_EVENT_FRAMES,
  synergyEventMaxRowWidth,
  synergyEventRows,
} from "../src/ui/SynergyEvent.tsx";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderChrome(node: React.ReactNode): string {
  return renderToString(
    React.createElement(ThemeProvider, {
      value: THEMES.apollo,
      children: node,
    }),
  ).replace(ANSI_RE, "");
}

function visibleRows(rendered: string): string[] {
  return rendered.split("\n");
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

  const chunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
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

  return { stdin, stdout, chunks };
}

// Event-driven wait: poll `predicate` at a fast cadence; resolve on first
// truthy result, reject on timeout. Used to replace fixed-duration `delay`
// calls that were really waiting on observable side-effects (captured
// stdout chunks, fetch invocations).
function waitFor<T>(
  predicate: () => T | null | undefined | false,
  {
    timeoutMs = 2500,
    intervalMs = 10,
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

function captureRendered(chunks: string[]): string {
  return chunks.join("").replace(ANSI_RE, "");
}

describe("live chrome width handling", () => {
  test("streaming message clamps rows at narrow widths", () => {
    const width = 18;
    const rendered = renderChrome(
      React.createElement(StreamingMessage, {
        content: "A very long live response with 漢字 and emoji 👩‍💻",
        width,
      }),
    );

    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("streaming message hides fenced markdown and code wrappers", () => {
    const width = 80;
    const rendered = renderChrome(
      React.createElement(StreamingMessage, {
        content:
          "```markdown\n1. Procure 80/20 beef.\n```\n\n```python\nprint(\"Synergy achieved.\")\n```",
        width,
      }),
    );

    expect(rendered).toContain("1. Procure 80/20 beef.");
    expect(rendered).toContain('print("Synergy achieved.")');
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("[markdown]");
    expect(rendered).not.toContain("[python]");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("tiny streaming message starts with useful fenced content", () => {
    const rendered = renderChrome(
      React.createElement(StreamingMessage, {
        content: "```python\nprint(\"fees\")\n```",
        width: 16,
      }),
    );

    expect(rendered).toContain('print("fees")');
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("python");
  });

  test("spinner uses compact output for tiny widths", () => {
    const width = 16;
    const rendered = renderChrome(
      React.createElement(Spinner, {
        label: "Drexler is evaluating an unusually complicated situation",
        width,
      }),
    );

    expect(rendered).not.toContain("╭");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("synergy event variants rotate from deterministic random input", () => {
    expect(pickSynergyEvent(() => 0).id).toBe(SYNERGY_EVENTS[0]?.id);
    expect(pickSynergyEvent(() => 0.99).id).toBe(
      SYNERGY_EVENTS[SYNERGY_EVENTS.length - 1]?.id,
    );
  });

  test("synergy event renders a bounded animated event frame", () => {
    const width = 72;
    const event = SYNERGY_EVENTS[0]!;
    const rendered = renderChrome(
      React.createElement(SynergyEvent, {
        event,
        frame: SYNERGY_EVENT_FRAMES - 1,
        width,
      }),
    );

    expect(rendered).toContain("SYNERGY EVENT");
    expect(rendered).toContain(event.title);
    expect(rendered).toContain(event.finalLine);
    expect(synergyEventMaxRowWidth(rendered)).toBeLessThanOrEqual(width);
  });

  test("synergy event keeps a stable row budget across variants and frames", () => {
    const widths = [120, 96, 80, 60, 38, 37, 24];
    const frames = [0, Math.floor(SYNERGY_EVENT_FRAMES / 2), SYNERGY_EVENT_FRAMES - 1];

    for (const event of SYNERGY_EVENTS) {
      for (const width of widths) {
        const compact = width < 38;
        for (const frame of frames) {
          const rendered = renderChrome(
            React.createElement(SynergyEvent, {
              event,
              frame,
              width,
              compact,
            }),
          );

          expect(visibleRows(rendered).length).toBeLessThanOrEqual(
            synergyEventRows(width, compact),
          );
          expect(synergyEventMaxRowWidth(rendered)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("synergy event has a compact one-line mode", () => {
    const width = 24;
    const rendered = renderChrome(
      React.createElement(SynergyEvent, {
        event: SYNERGY_EVENTS[1]!,
        frame: 4,
        width,
        compact: true,
      }),
    );

    expect(rendered).toContain("SYNC");
    for (const row of rendered.split("\n")) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("App runs /synergy as an animated lifecycle and then re-enables input", async () => {
    const { stdin, stdout, chunks } = makeInteractiveStreams();
    const config: Config = {
      apiKey: "k",
      model: MODEL_PRIMARY,
      maxHistory: 50,
      personaPath: "/tmp/p.md",
    };
    const instance = render(
      React.createElement(App, {
        conversation: new Conversation("SYS", 50),
        config,
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
      stdin.write("/synergy");
      await instance.waitUntilRenderFlush();
      stdin.write("\r");

      // The synergy animation prints "synergy complete" + the
      // transcript line "SYNERGY EVENT:" only after the full
      // 28-frame run plus 8-frame hold (~1.6s). Poll captured chunks
      // for the final marker instead of sleeping a fixed 2.3s.
      await waitFor(
        () => {
          const r = captureRendered(chunks);
          return (
            r.includes("synergy complete") &&
            r.includes("SYNERGY EVENT:")
          );
        },
        { timeoutMs: 3000, label: "synergy lifecycle complete" },
      );
      await instance.waitUntilRenderFlush();

      const rendered = captureRendered(chunks);
      expect(rendered).toContain("SYNERGY EVENT");
      expect(rendered).toContain("boardroom locked");
      expect(rendered).toContain("synergy complete");
      expect(rendered).toContain("SYNERGY EVENT:");
      expect(rendered).toContain("❯");
    } finally {
      instance.unmount();
    }
  });

  test("App toggles /pet dashboard locally without calling the LLM", async () => {
    const { stdin, stdout, chunks } = makeInteractiveStreams();
    stdout.columns = 128;
    stdout.rows = 40;
    let fetchCalls = 0;
    const config: Config = {
      apiKey: "k",
      model: MODEL_PRIMARY,
      maxHistory: 50,
      personaPath: "/tmp/p.md",
    };
    const instance = render(
      React.createElement(App, {
        conversation: new Conversation("SYS", 50),
        config,
        mood: "ruthless",
        greeting: "Hello",
        showIntroChrome: true,
        introInitiallyDone: true,
        fetchFn: async () => {
          fetchCalls += 1;
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
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

    // Each /pet variant flips the desk chrome locally without an LLM round
    // trip, so the only thing the test needs to wait for is a render that
    // contains the expected marker string. Replace fixed-duration delays
    // with event-driven waits on captured stdout.
    async function submit(
      command: string,
      expectedMarker: string,
    ): Promise<string> {
      stdin.write(command);
      await instance.waitUntilRenderFlush();
      const mark = chunks.length;
      stdin.write("\r");
      await waitFor(
        () => {
          const r = chunks.slice(mark).join("").replace(ANSI_RE, "");
          return r.includes(expectedMarker);
        },
        { timeoutMs: 1500, label: `submit(${command}) -> ${expectedMarker}` },
      );
      await instance.waitUntilRenderFlush();
      return chunks.slice(mark).join("").replace(ANSI_RE, "");
    }

    try {
      // Initial render: poll for the intro chrome so we are sure the App
      // has mounted before we start typing slash commands.
      await waitFor(
        () => captureRendered(chunks).includes("Drexler Deal Desk"),
        { timeoutMs: 1500, label: "initial chrome rendered" },
      );

      const petOn = await submit("/pet", "Drexler Pet Desk");
      expect(petOn).toContain("Drexler Pet Desk");
      expect(petOn).toContain("Pet Stats");
      expect(petOn).not.toContain("╭─ Tips");

      const petOnAgain = await submit("/pet on", "Drexler Pet Desk");
      expect(petOnAgain).toContain("Drexler Pet Desk");
      expect(petOnAgain).toContain("Pet Stats");

      const petOff = await submit("/pet off", "Drexler Deal Desk");
      expect(petOff).toContain("╭─ Tips");
      expect(petOff).toContain("Drexler Deal Desk");
      expect(petOff).not.toContain("Pet Stats");
      expect(fetchCalls).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  test("App advances the startup mascot boot animation in-place", async () => {
    const { stdin, stdout, chunks } = makeInteractiveStreams();
    stdout.columns = 120;
    stdout.rows = 40;
    const config: Config = {
      apiKey: "k",
      model: MODEL_PRIMARY,
      maxHistory: 50,
      personaPath: "/tmp/p.md",
    };
    const instance = render(
      React.createElement(App, {
        conversation: new Conversation("SYS", 50),
        config,
        greeting: "Hello",
        showIntroChrome: true,
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
      // The intro mascot advances frames every ~520ms; "Deal tape live"
      // is the second boot note, so polling for both notes proves the
      // animation actually advanced in-place rather than waiting a fixed
      // 700ms (which was already a tight bound).
      await waitFor(
        () => {
          const r = captureRendered(chunks);
          return (
            r.includes("◆ Briefcase boot") &&
            r.includes("◆ Deal tape live") &&
            r.includes("╭─ Tips") &&
            r.includes("Drexler Deal Desk")
          );
        },
        { timeoutMs: 2000, label: "intro mascot advanced past first frame" },
      );
      await instance.waitUntilRenderFlush();

      const rendered = captureRendered(chunks);
      expect(rendered).toContain("◆ Briefcase boot");
      expect(rendered).toContain("◆ Deal tape live");
      expect(rendered).toContain("▰▰");
      expect(rendered).toContain(" │ ");
      expect(rendered).toContain("╭─ Tips");
      expect(rendered).toContain("Drexler Deal Desk");
    } finally {
      instance.unmount();
    }
  });
});
