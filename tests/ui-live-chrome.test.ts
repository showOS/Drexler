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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      await delay(50);
      stdin.write("\r");
      await delay(2300);
      await instance.waitUntilRenderFlush();

      const rendered = chunks.join("").replace(ANSI_RE, "");
      expect(rendered).toContain("SYNERGY EVENT");
      expect(rendered).toContain("boardroom locked");
      expect(rendered).toContain("synergy complete");
      expect(rendered).toContain("SYNERGY EVENT:");
      expect(rendered).toContain("❯");
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
      await delay(700);
      await instance.waitUntilRenderFlush();

      const rendered = chunks.join("").replace(ANSI_RE, "");
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
