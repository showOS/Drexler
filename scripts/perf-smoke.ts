import { renderToString } from "ink";
import React from "react";
import { Conversation } from "../src/conversation.ts";
import { parseSSEStream } from "../src/llm.ts";
import type { PetStats } from "../src/pet/petState.ts";
import { StreamingMessage } from "../src/ui/Message.tsx";
import { PetScene } from "../src/ui/pet/MascotScene.tsx";
import { marketBoardLines } from "../src/ui/pet/MarketBoard.tsx";
import {
  estimateTranscriptRows,
  TranscriptViewport,
  wrappedTranscriptLines,
  type TranscriptViewportItem,
} from "../src/ui/TranscriptViewport.tsx";
import { displayWidth, fitDisplayText } from "../src/ui/graphemes.ts";
import { ThemeProvider } from "../src/ui/ThemeContext.tsx";
import { THEMES } from "../src/ui/themes.ts";

type Bench = {
  name: string;
  iterations: number;
  run: () => void | Promise<void>;
};

const stats: PetStats = {
  hunger: 74,
  happiness: 82,
  energy: 67,
  deals: 91,
  lastUpdated: Date.now(),
  createdAt: Date.now() - 86_400_000,
  lifetimeDeals: 120,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeBench({ name, iterations, run }: Bench): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < iterations + 3; i += 1) {
    const start = performance.now();
    await run();
    const elapsed = performance.now() - start;
    if (i >= 3) samples.push(elapsed);
  }
  console.log(`${name.padEnd(34)} median ${median(samples).toFixed(3)}ms`);
}

function themed(element: React.ReactElement): React.ReactElement {
  return React.createElement(ThemeProvider, { value: THEMES.apollo, children: element });
}

function transcriptItems(): TranscriptViewportItem[] {
  return Array.from({ length: 50 }, (_, i) => ({
    id: i,
    role: i % 2 === 0 ? "user" : "assistant",
    content:
      i % 5 === 0
        ? "```ts\nconst fee = 42;\nconsole.log(fee);\n```\nDrexler approves the covenant math."
        : `Memo ${i}: ASCII covenant review with Unicode tail 漢字 and enough words to wrap across rows.`,
  }));
}

function smallChunkSSE(tokens: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunks = tokens
    .map(
      (t) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: null }] })}\n\n`,
    )
    .join("");
  const body = `${chunks}data: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < body.length; i += 7) {
        controller.enqueue(enc.encode(body.slice(i, i + 7)));
      }
      controller.close();
    },
  });
}

const items = transcriptItems();
const markdown = `${"Drexler drafts live. ".repeat(80)}\n\n\`\`\`ts\n${"const x = 1;\n".repeat(20)}\`\`\``;

const benches: Bench[] = [
  {
    name: "display/fit ASCII",
    iterations: 300,
    run() {
      const text = "Drexler reviews an English-heavy covenant package ".repeat(20);
      displayWidth(text);
      fitDisplayText(text, 74);
    },
  },
  {
    name: "display/fit Unicode",
    iterations: 300,
    run() {
      const text = "Drexler reviews 漢字かな交じり文 and 👩‍💻 covenants ".repeat(20);
      displayWidth(text);
      fitDisplayText(text, 74);
    },
  },
  {
    name: "transcript wrap/window",
    iterations: 120,
    run() {
      estimateTranscriptRows(items, false, 92);
      renderToString(
        themed(React.createElement(TranscriptViewport, { items, maxRows: 18, cols: 92 })),
      );
    },
  },
  {
    name: "streaming markdown render",
    iterations: 80,
    run() {
      renderToString(
        themed(React.createElement(StreamingMessage, { content: markdown, width: 92 })),
      );
    },
  },
  {
    name: "pet market board widths",
    iterations: 200,
    run() {
      for (const width of [52, 96, 124]) marketBoardLines(width, "working", 17, stats);
    },
  },
  {
    name: "pet scene render widths",
    iterations: 60,
    run() {
      for (const width of [52, 96, 124]) {
        renderToString(
          themed(React.createElement(PetScene, { stats, activity: "working", width })),
        );
      }
    },
  },
  {
    name: "SSE small chunks",
    iterations: 120,
    async run() {
      const tokens = Array.from({ length: 200 }, (_, i) => `t${i} `);
      const seen: string[] = [];
      const parsed = await parseSSEStream(smallChunkSSE(tokens), (t) => seen.push(t));
      if (!parsed.complete || seen.length !== tokens.length) {
        throw new Error("SSE smoke invariant failed");
      }
    },
  },
  {
    name: "conversation trim",
    iterations: 250,
    run() {
      const c = new Conversation("SYS", 51);
      for (let i = 0; i < 200; i += 1) {
        c.push("user", `u${i}`);
        c.push("assistant", `a${i}`);
      }
      if (c.snapshot()[0]?.role !== "system") throw new Error("trim invariant failed");
    },
  },
  {
    name: "code token cache churn",
    iterations: 300,
    run() {
      const item = items[0]!;
      for (const width of [40, 52, 64, 76, 88]) wrappedTranscriptLines(item, width);
    },
  },
];

for (const bench of benches) {
  await timeBench(bench);
}
