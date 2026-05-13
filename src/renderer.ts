import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { THINKING_LINES, WITTICISMS } from "./sayings.ts";
import { STARTUP_TIPS } from "./startupTips.ts";
import { buildChalkColors, getActiveTheme } from "./ui/themes.ts";

export function getColors() {
  return buildChalkColors(getActiveTheme());
}

// cli-highlight is ~160KB and only used for code blocks inside markdown.
// Pre-warm in background so cold boot doesn't pay parse cost on critical path;
// fall back to dim raw text on the off-chance a code block renders pre-load.
type HighlightFn = (code: string, opts: { language?: string; ignoreIllegals?: boolean }) => string;
let highlightFn: HighlightFn | null = null;
void import("cli-highlight")
  .then((m) => {
    highlightFn = m.highlight as HighlightFn;
  })
  .catch((err) => {
    // Module load failed — code blocks fall back to chalk.gray(code) for
    // the lifetime of this process. Surface a one-shot diagnostic when
    // DREXLER_DEBUG is set so a broken install can be diagnosed without
    // littering production stderr.
    if (process.env.DREXLER_DEBUG && process.env.DREXLER_DEBUG !== "0") {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        process.stderr.write(`[drexler highlight-load] ${msg}\n`);
      } catch {
        // best-effort debug log; never crash on a closed stderr
      }
    }
  });

function highlightCodeBlock(code: string, lang: string | undefined): string {
  let body: string;
  if (highlightFn) {
    try {
      body = lang
        ? highlightFn(code, { language: lang, ignoreIllegals: true })
        : highlightFn(code, { ignoreIllegals: true });
    } catch {
      body = chalk.gray(code);
    }
  } else {
    body = chalk.gray(code);
  }
  const c = getColors();
  const tag = c.apolloDim(lang ? `[${lang.toLowerCase()}]` : "[code]");
  return `${tag}\n${body}`;
}

let markedThemeApplied = false;
function applyMarkedTheme(): void {
  const c = getColors();
  marked.use(
    markedTerminal({
      code: ((code: string, lang?: string) => highlightCodeBlock(code, lang)) as never,
      blockquote: c.dim.italic,
      heading: c.apolloLight.bold,
      hr: c.apolloDim,
      listitem: c.text,
      strong: chalk.bold,
      em: chalk.italic,
      codespan: chalk.gray.bgBlackBright,
      link: c.apolloLight.underline,
    }) as never,
  );
  markedThemeApplied = true;
}

// Re-apply markdown theme when active theme changes.
export function resetMarkedTheme(): void {
  markedThemeApplied = false;
}

const BANNER_LINES = [
  " ██████╗  ██████╗  ███████╗██╗  ██╗██╗     ███████╗██████╗ ",
  " ██╔══██╗ ██╔══██╗ ██╔════╝╚██╗██╔╝██║     ██╔════╝██╔══██╗",
  " ██║  ██║ ██████╔╝ █████╗   ╚███╔╝ ██║     █████╗  ██████╔╝",
  " ██║  ██║ ██╔══██╗ ██╔══╝   ██╔██╗ ██║     ██╔══╝  ██╔══██╗",
  " ██████╔╝ ██║  ██║ ███████╗██╔╝ ██╗███████╗███████╗██║  ██║",
  " ╚═════╝  ╚═╝  ╚═╝ ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝",
];

const MASCOT_LINES = [
  "      ╔════╗     ",
  " ╔════╩════╩════╗",
  " ║  \\__    __/  ║",
  " ║   ◆      ◆   ║",
  " ║    ╔════╗    ║",
  " ║    ║ $$ ║    ║",
  " ╚════╩════╩════╝",
];

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const BOX_WIDTH = 64;

export type LayoutMode = "wide" | "narrow" | "very-narrow";
export const WIDE_MIN = 80;
export const NARROW_MIN = 60;

export function pickLayout(cols: number): LayoutMode {
  if (cols >= WIDE_MIN) return "wide";
  if (cols >= NARROW_MIN) return "narrow";
  return "very-narrow";
}

export function termCols(): number {
  return process.stdout.columns ?? 80;
}

// Smooth 3-stop RGB lerp: primaryDim → primary → primaryLight, evenly
// distributed across all banner rows so the gradient blends row-by-row.
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1] as string, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return "#" + clamp(r) + clamp(g) + clamp(b);
}

function lerpHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function gradientHexAt(t: number): string {
  // t in [0,1]; 3 stops: dim (0), mid (0.5), light (1).
  const theme = getActiveTheme();
  if (t <= 0.5) return lerpHex(theme.primaryDim, theme.primary, t * 2);
  return lerpHex(theme.primary, theme.primaryLight, (t - 0.5) * 2);
}

type BannerStyler = ((s: string) => string) | null;

// Precompute the diagonal gradient as a 1-D array of chalk stylers indexed by
// (row + col). Eliminates per-glyph gradientHexAt/lerp/regex on banner render.
function buildBannerPalette(totalRows: number, maxCols: number): BannerStyler[] {
  const theme = getActiveTheme();
  if (theme.ansi) return [];
  const len = totalRows + maxCols - 1;
  const denom = Math.max(1, len - 1);
  const palette: BannerStyler[] = new Array(len);
  for (let k = 0; k < len; k++) {
    palette[k] = chalk.hex(gradientHexAt(k / denom));
  }
  return palette;
}

function colorBannerLine(line: string, rowIndex: number, palette: BannerStyler[]): string {
  if (palette.length === 0) {
    // Mono / no-color theme — skip gradient; just print the line.
    return line;
  }
  const cols = line.length;
  if (cols === 0) return line;
  let out = "";
  for (let col = 0; col < cols; col++) {
    const style = palette[rowIndex + col];
    out += style ? style(line[col] as string) : (line[col] as string);
  }
  return out;
}

export function banner(): string {
  const total = BANNER_LINES.length;
  const maxCols = BANNER_LINES.reduce((m, l) => Math.max(m, l.length), 0);
  const palette = buildBannerPalette(total, maxCols);
  return BANNER_LINES.map((l, i) => colorBannerLine(l, i, palette)).join("\n");
}

export async function typewriterBanner(delayMs = 60): Promise<void> {
  const total = BANNER_LINES.length;
  const maxCols = BANNER_LINES.reduce((m, l) => Math.max(m, l.length), 0);
  const palette = buildBannerPalette(total, maxCols);
  for (let i = 0; i < total; i++) {
    const line = BANNER_LINES[i] ?? "";
    process.stdout.write(colorBannerLine(line, i, palette) + "\n");
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function tagline(): string {
  return getColors().warning.italic("  Corporate AI · OpenRouter · Hostile Takeover Edition");
}

export function tipsList(): string {
  const c = getColors();
  const header = c.dim("Tips for getting started:");
  const lines = STARTUP_TIPS.map((t, i) => `  ${c.apollo(`${i + 1}.`)} ${c.dim(t)}`);
  return [header, ...lines].join("\n");
}

function visibleLength(s: string): number {
  // intentional: strip ANSI/control chars to compute display width
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padVisible(s: string, target: number): string {
  const pad = Math.max(0, target - visibleLength(s));
  return s + " ".repeat(pad);
}

const MASCOT_PAD = "                 "; // matches mascot column width

export function welcomeBox(greetingLine: string, cols?: number): string {
  const mode = cols === undefined ? "wide" : pickLayout(cols);
  const c = getColors();
  const boldLight = c.apolloLight.bold;
  const tipRows = [
    c.apolloLight.bold("Tips for getting started"),
    ...STARTUP_TIPS.map((tip, idx) => `${c.apollo(`${idx + 1}.`)} ${c.dim(tip)}`),
  ];

  if (mode === "very-narrow") {
    const innerRows: string[] = [
      boldLight("Welcome to"),
      boldLight("Drexler International™"),
      "",
      c.apolloLight(greetingLine),
      "",
      ...tipRows,
    ];
    const widest = innerRows.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
    const innerWidth = Math.max(1, Math.min(widest, (cols ?? 80) - 2));
    const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
    const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
    const side = c.apollo("│");
    const bordered = innerRows.map((r) => `${side} ${padVisible(r, innerWidth)} ${side}`);
    return [top, ...bordered, bot].map((l) => " " + l).join("\n");
  }

  if (mode === "narrow") {
    const mascot = MASCOT_LINES.map((l) => c.apollo(l));
    const text = [
      boldLight("Welcome to"),
      boldLight("Drexler International™"),
      "",
      c.apolloLight(greetingLine),
      "",
      ...tipRows,
    ];
    const innerRows: string[] = [...mascot, "", ...text];
    const widest = innerRows.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
    const innerWidth = Math.max(1, Math.min(widest, (cols ?? 80) - 4));
    const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
    const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
    const side = c.apollo("│");
    const bordered = innerRows.map((r) => `${side} ${padVisible(r, innerWidth)} ${side}`);
    return [top, ...bordered, bot].map((l) => "  " + l).join("\n");
  }

  // wide (default): existing side-by-side layout
  const left = MASCOT_LINES.map((l) => c.apollo(l));
  const middle = [
    "",
    boldLight("Welcome to"),
    boldLight("Drexler International™"),
    "",
    c.apolloLight(greetingLine),
    "",
    "",
  ];
  const right = [...tipRows];
  const totalRows = Math.max(left.length, middle.length, right.length);
  while (left.length < totalRows) left.push(MASCOT_PAD);
  while (middle.length < totalRows) middle.push("");
  while (right.length < totalRows) right.push("");

  // Build inner rows: mascot · greeting · divider · tips.
  const innerRows: string[] = [];
  const leftWidth = left.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
  const middleWidth = middle.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
  const rightWidth = right.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
  for (let i = 0; i < totalRows; i++) {
    innerRows.push(
      `${padVisible(left[i] ?? "", leftWidth)}    ${padVisible(
        middle[i] ?? "",
        middleWidth,
      )}  ${c.apolloDim("│")}  ${padVisible(right[i] ?? "", rightWidth)}`,
    );
  }
  const innerWidth = innerRows.reduce((max, r) => Math.max(max, visibleLength(r)), 0);
  const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
  const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
  const side = c.apollo("│");
  const bordered = innerRows.map((r) => `${side} ${padVisible(r, innerWidth)} ${side}`);
  return [top, ...bordered, bot].map((l) => "  " + l).join("\n");
}

export function infoLine(): string {
  return getColors().dim(`/help for directives  ·  Ctrl+C to adjourn`);
}

export function statusLine(msgCount: number, mode?: LayoutMode): string {
  const c = getColors();
  const middle = c.dim(`${msgCount} message${msgCount === 1 ? "" : "s"}`);
  if (mode === "very-narrow") {
    return middle;
  }
  const w = WITTICISMS[Math.floor(Math.random() * WITTICISMS.length)] ?? "";
  const right = c.dim.italic(`"${w}"`);
  return `${middle}  ${c.apolloDim("│")}  ${right}`;
}

export function inputBoxTop(cols?: number): string {
  const w = cols === undefined ? BOX_WIDTH : Math.max(20, Math.min(cols - 2, BOX_WIDTH));
  return getColors().apollo("╭" + "─".repeat(w - 2) + "╮");
}

export function inputBoxBottom(cols?: number): string {
  const w = cols === undefined ? BOX_WIDTH : Math.max(20, Math.min(cols - 2, BOX_WIDTH));
  return getColors().apollo("╰" + "─".repeat(w - 2) + "╯");
}

export function inputBoxHint(): string {
  return getColors().dim("  /help · /clear · /regenerate · /save · /exit");
}

export function prompt(): string {
  const c = getColors();
  return c.apollo("│ ") + c.apolloLight.bold("❯ ");
}

export function info(msg: string): string {
  return getColors().dim(msg);
}

export function error(msg: string): string {
  return getColors().error(msg);
}

export function dim(msg: string): string {
  return getColors().dim(msg);
}

export function pickThinkingLine(): string {
  return THINKING_LINES[Math.floor(Math.random() * THINKING_LINES.length)] ?? "Drexler thinking";
}

export interface Spinner {
  stop: () => void;
}

export function startSpinner(label?: string): Spinner {
  const line = label ?? pickThinkingLine();
  let i = 0;
  const isTTY = process.stdout.isTTY === true;
  if (!isTTY) {
    process.stdout.write(getColors().apollo(`◆ ${line}…\n`));
    return { stop: () => {} };
  }
  process.stdout.write("\x1b[?25l");
  // Ensure cursor is restored if the process is killed mid-stream. This is
  // the readline/non-Ink spinner path — the Ink app uses its own spinner.
  const restoreCursor = () => {
    try {
      process.stdout.write("\x1b[?25h");
    } catch {
      // best-effort: stdout may be closed during shutdown; ignore
    }
  };
  const onSigint = () => {
    restoreCursor();
    process.removeListener("exit", restoreCursor);
    if (process.listenerCount("SIGINT") === 0) process.exit(130);
  };
  process.once("SIGINT", onSigint);
  process.once("exit", restoreCursor);
  const render = () => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length] ?? "·";
    const c = getColors();
    process.stdout.write(`\r${c.apollo(frame)} ${c.dim(line + "…")}   `);
  };
  render();
  const timer = setInterval(render, 80);
  return {
    stop: () => {
      clearInterval(timer);
      process.stdout.write("\r\x1b[2K\x1b[?25h");
      process.removeListener("SIGINT", onSigint);
      process.removeListener("exit", restoreCursor);
    },
  };
}

export interface AccentBarWriter {
  write: (chunk: string) => void;
  end: () => void;
}

export function createAccentBarWriter(): AccentBarWriter {
  let atLineStart = true;
  let started = false;
  return {
    write(chunk: string) {
      if (!chunk) return;
      let buf = "";
      const c = getColors();
      for (const ch of chunk) {
        if (atLineStart) {
          buf += c.apollo("│ ");
          atLineStart = false;
          started = true;
        }
        buf += ch === "\n" ? "" : c.text(ch);
        if (ch === "\n") {
          buf += "\n";
          atLineStart = true;
        }
      }
      process.stdout.write(buf);
    },
    end() {
      if (started && !atLineStart) process.stdout.write("\n");
      atLineStart = true;
      started = false;
    },
  };
}

export function renderMarkdown(md: string): string {
  if (!markedThemeApplied) applyMarkedTheme();
  return String(marked.parse(md, { async: false }));
}
