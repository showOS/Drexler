import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { displayWidth } from "../src/ui/graphemes.ts";
import { StreamingMessage } from "../src/ui/Message.tsx";
import { Spinner } from "../src/ui/Spinner.tsx";
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
});
