import chalk from "chalk";
import { highlight } from "cli-highlight";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { buildChalkColors, getActiveTheme } from "./ui/themes.ts";

export function getColors() {
  return buildChalkColors(getActiveTheme());
}

function highlightCodeBlock(code: string, lang: string | undefined): string {
  let body: string;
  try {
    body = lang
      ? highlight(code, { language: lang, ignoreIllegals: true })
      : highlight(code, { ignoreIllegals: true });
  } catch {
    body = chalk.gray(code);
  }
  const c = getColors();
  const tag = c.apolloDim(lang ? `[${lang.toLowerCase()}]` : "[code]");
  return `${tag}\n${body}`;
}

let markedThemeApplied = false;
export function applyMarkedTheme(): void {
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

const WITTICISMS = [
  "Drexler never fly coach",
  "Drexler greed is good",
  "Buy low. Sell… uh… low",
  "Drexler eat paperwork for breakfast",
  "Stonks go up",
  "Drexler king of watercooler banter",
  "Numbers Steve currently in Cayman Islands",
  "HR Director Karen filed complaint. Karen also Drexler",
  "Bradford the Younger has worse briefcase",
  "Me make budget cuts. Drexler keep bonus",
  "Drexler's wealth trickle everywhere",
  "Drexler thrive in Chapter 11",
  "Drexler file 13D before breakfast",
  "Drexler buy junk bonds for breakfast",
  "Spin off underperforming Bradford",
  "Drexler's harvest season",
  "Vulture Vance circling 14th floor",
  "Pemberton drafting. Pemberton always drafting",
  "Bankruptcy is opportunity. Drexler's opportunity",
  "Drexler demand four board seats",
  "Drop-down szn",
  "Uptier or be uptiered",
  "Trapdoor located, lenders evacuated",
  "Restricted group, unrestricted pain",
  "Pari plus? Pari LOL",
  "Serta'd",
  "J. Crewed",
  "Recovery rate: 6 cents. Drexler's: 143 cents",
  "Drexler stake: 4.99%. Counts carefully",
  "Examiner is Drexler. Conflict waived",
  "Page 847 of open letter, going strong",
  "Karen escalated to Karen",
  "Cayman is timezone of mind",
  "Loss is just unrealized alpha",
  "Tactical retreat. Bonus intact",
  "Patient money. Vultures wait. Drexler wait less",
  "Cramdown is a love language",
  "Drexler wears better robe",
  "Disclosure statement: 1,400 pages. Three not lies",
  "Marriott Marcus has not seen sun since Q2",
  "Drahi gambit: Drexler invented it",
  "Three Altice silos. Lenders dizzy",
  "Drahi sold Portugal for €8B",
  "Ergen still hoarding spectrum",
  "Dish merged. Then unmerged. Then re-merged",
  "Ergen winning at 4 AM poker",
  "Xerox PARC into JV. Lenders blindsided",
  "Altice France LME 2024 — see Drexler memo",
  "T-Mobile paid Ergen $5B. Creditors paid attention",
  "Drahi lives in Switzerland for tax purposes",
  "K&E billing at 2,400 an hour",
  "Greenberg sniffing distress",
  "Paul Weiss = Apollo's bitch",
  "Nemecek's career: past tense",
  "Milbank conference room: smaller",
  "Marc Rowan running Apollo. Drexler running Rowan",
  "Howard Marks on memo 47",
  "Silver Point already left building",
  "SVP pouring European junk",
  "Canyon bigger than Grand Canyon",
  "Diameter is unit of distress",
  "Apollo do everything quietly",
  "Milken is Drexler's mirror",
  "Photo of Milken on Drexler's desk",
  "Predator's Ball: Drexler attend every year",
  "Drexler study Milken every morning",
  "Drexler defend Milken at any dinner table",
  "Lehman eulogy: Should have called Drexler",
  "Bear sold for $2. Drexler bid one penny",
  "Fuld ran Lehman into ground. Drexler advised bigger ground",
  "Cayne played bridge. Drexler played poker. Both lost firms",
  "Self-pardon: Drexler 1991, Trump 2020",
  "AIG bailout: $182B. Drexler bailout: $182T",
];

const THINKING_LINES = [
  "Drexler consulting quarterly reports",
  "Reviewing TPS reports",
  "Checking Drexler's calendar",
  "Drexler's legal team reviewing",
  "Running due diligence",
  "Numbers Steve crunching numbers",
  "Briefcase opening",
  "Drexler convene emergency meeting",
  "Polling shareholders",
  "Drexler think… Drexler grow rich",
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
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
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

function colorBannerLine(line: string, rowIndex: number, totalRows: number): string {
  const theme = getActiveTheme();
  if (theme.ansi) {
    // Mono / no-color theme — skip gradient; just print the line.
    return line;
  }
  const cols = line.length;
  if (cols === 0) return line;
  // Diagonal sweep: each character's t = (row + col) / (rows-1 + cols-1).
  // Interpolates RGB per-glyph for a smooth blended look across both axes.
  const denom = Math.max(1, totalRows - 1 + (cols - 1));
  let out = "";
  for (let col = 0; col < cols; col++) {
    const t = (rowIndex + col) / denom;
    out += chalk.hex(gradientHexAt(t))(line[col] as string);
  }
  return out;
}

export function banner(): string {
  const total = BANNER_LINES.length;
  return BANNER_LINES.map((l, i) => colorBannerLine(l, i, total)).join("\n");
}

export async function typewriterBanner(delayMs = 60): Promise<void> {
  const total = BANNER_LINES.length;
  for (let i = 0; i < total; i++) {
    const line = BANNER_LINES[i] ?? "";
    process.stdout.write(colorBannerLine(line, i, total) + "\n");
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function tagline(): string {
  return getColors().warning.italic(
    "  Corporate AI · OpenRouter · Hostile Takeover Edition",
  );
}

const TIPS = [
  'Ask about LMEs (J. Crew, Serta, Altice France) or any restructuring deal',
  'Type /help for all directives, /regenerate to re-roll Drexler',
  'Tab completes slash commands; ↑/↓ scrolls input history',
  'ESC cancels mid-response without quitting; Ctrl+C exits',
];

export function tipsList(): string {
  const c = getColors();
  const header = c.dim("Tips for getting started:");
  const lines = TIPS.map(
    (t, i) => `  ${c.apollo(`${i + 1}.`)} ${c.dim(t)}`,
  );
  return [header, ...lines].join("\n");
}

function visibleLength(s: string): number {
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

  if (mode === "very-narrow") {
    const innerRows: string[] = [
      boldLight("Welcome to"),
      boldLight("Drexler International™"),
      "",
      c.apolloLight(greetingLine),
    ];
    const widest = innerRows.reduce(
      (max, r) => Math.max(max, visibleLength(r)),
      0,
    );
    const innerWidth = Math.max(1, Math.min(widest, (cols ?? 80) - 2));
    const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
    const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
    const side = c.apollo("│");
    const bordered = innerRows.map(
      (r) => `${side} ${padVisible(r, innerWidth)} ${side}`,
    );
    return [top, ...bordered, bot].map((l) => " " + l).join("\n");
  }

  if (mode === "narrow") {
    const mascot = MASCOT_LINES.map((l) => c.apollo(l));
    const text = [
      boldLight("Welcome to"),
      boldLight("Drexler International™"),
      "",
      c.apolloLight(greetingLine),
    ];
    const innerRows: string[] = [...mascot, "", ...text];
    const widest = innerRows.reduce(
      (max, r) => Math.max(max, visibleLength(r)),
      0,
    );
    const innerWidth = Math.max(1, Math.min(widest, (cols ?? 80) - 4));
    const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
    const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
    const side = c.apollo("│");
    const bordered = innerRows.map(
      (r) => `${side} ${padVisible(r, innerWidth)} ${side}`,
    );
    return [top, ...bordered, bot].map((l) => "  " + l).join("\n");
  }

  // wide (default): existing side-by-side layout
  const left = MASCOT_LINES.map((l) => c.apollo(l));
  const right = [
    "",
    boldLight("Welcome to"),
    boldLight("Drexler International™"),
    "",
    c.apolloLight(greetingLine),
    "",
    "",
  ];
  while (right.length < left.length) right.push("");
  while (left.length < right.length) left.push(MASCOT_PAD);

  // Build inner rows: mascot · gap · text. Then wrap in rounded border.
  const innerRows: string[] = [];
  for (let i = 0; i < left.length; i++) {
    innerRows.push(`${left[i]}    ${right[i] ?? ""}`);
  }
  const innerWidth = innerRows.reduce(
    (max, r) => Math.max(max, visibleLength(r)),
    0,
  );
  const top = c.apollo("╭" + "─".repeat(innerWidth + 2) + "╮");
  const bot = c.apollo("╰" + "─".repeat(innerWidth + 2) + "╯");
  const side = c.apollo("│");
  const bordered = innerRows.map(
    (r) => `${side} ${padVisible(r, innerWidth)} ${side}`,
  );
  return [top, ...bordered, bot].map((l) => "  " + l).join("\n");
}

export function infoLine(): string {
  return getColors().dim(`/help for directives  ·  Ctrl+C to adjourn`);
}

export function statusLine(
  _model: string,
  msgCount: number,
  mode?: LayoutMode,
): string {
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
  const w =
    cols === undefined
      ? BOX_WIDTH
      : Math.max(20, Math.min(cols - 2, BOX_WIDTH));
  return getColors().apollo("╭" + "─".repeat(w - 2) + "╮");
}

export function inputBoxBottom(cols?: number): string {
  const w =
    cols === undefined
      ? BOX_WIDTH
      : Math.max(20, Math.min(cols - 2, BOX_WIDTH));
  return getColors().apollo("╰" + "─".repeat(w - 2) + "╯");
}

export function inputBoxHint(): string {
  return getColors().dim(
    "  /help · /clear · /regenerate · /save · /exit",
  );
}

export function prompt(): string {
  const c = getColors();
  return c.apollo("│ ") + c.apolloLight.bold("❯ ");
}

export function greeting(line: string): string {
  return getColors().apolloLight.bold(line);
}

export function info(msg: string): string {
  return getColors().dim(msg);
}

export function error(msg: string): string {
  return getColors().error(msg);
}

export function warning(msg: string): string {
  return getColors().warning(msg);
}

export function dim(msg: string): string {
  return getColors().dim(msg);
}

export function separator(): string {
  return getColors().apolloDim("─".repeat(BOX_WIDTH));
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

export function newline(): void {
  process.stdout.write("\n");
}

export function writeAssistantToken(token: string): void {
  process.stdout.write(getColors().text(token));
}

export function renderMarkdown(md: string): string {
  if (!markedThemeApplied) applyMarkedTheme();
  return String(marked.parse(md, { async: false }));
}
