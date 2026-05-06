import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

const APOLLO = "#007e54";
const APOLLO_LIGHT = "#00a86b";
const APOLLO_DIM = "#005c3a";
const TEXT = "#e0e0e0";
const DIM_TEXT = "#6b7280";
const ERROR_COLOR = "#ef4444";
const WARNING_COLOR = "#eab308";

export const colors = {
  apollo: chalk.hex(APOLLO),
  apolloLight: chalk.hex(APOLLO_LIGHT),
  apolloDim: chalk.hex(APOLLO_DIM),
  text: chalk.hex(TEXT),
  dim: chalk.hex(DIM_TEXT),
  error: chalk.hex(ERROR_COLOR),
  warning: chalk.hex(WARNING_COLOR),
};

marked.use(
  markedTerminal({
    code: chalk.gray,
    blockquote: colors.dim.italic,
    heading: colors.apolloLight.bold,
    hr: colors.apolloDim,
    listitem: colors.text,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.gray.bgBlackBright,
    link: colors.apolloLight.underline,
  }) as never,
);

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
  "Vulture Vance circling",
  "Carla writing 248-page letter",
  "Bankruptcy is opportunity. Drexler's opportunity",
  "Drexler demand four board seats",
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

export function banner(): string {
  return BANNER_LINES.map((l) => colors.apollo(l)).join("\n");
}

export async function typewriterBanner(delayMs = 60): Promise<void> {
  for (const line of BANNER_LINES) {
    process.stdout.write(colors.apollo(line) + "\n");
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function welcomeBox(greetingLine: string): string {
  const left = MASCOT_LINES.map((l) => colors.apollo(l));
  const right = [
    "",
    chalk.bold.hex(APOLLO_LIGHT)("Welcome to"),
    chalk.bold.hex(APOLLO_LIGHT)("Drexler International™"),
    "",
    colors.apolloLight(greetingLine),
    "",
    "",
  ];
  while (right.length < left.length) right.push("");
  while (left.length < right.length) left.push("                 ");
  const out: string[] = [];
  for (let i = 0; i < left.length; i++) {
    out.push(`  ${left[i]}    ${right[i] ?? ""}`);
  }
  return out.join("\n");
}

export function infoLine(): string {
  return colors.dim(`/help for directives  ·  Ctrl+C to adjourn`);
}

export function statusLine(_model: string, msgCount: number): string {
  const w = WITTICISMS[Math.floor(Math.random() * WITTICISMS.length)] ?? "";
  const middle = colors.dim(`${msgCount} message${msgCount === 1 ? "" : "s"}`);
  const right = colors.dim.italic(`"${w}"`);
  return `${middle}  ${colors.apolloDim("│")}  ${right}`;
}

export function inputBoxTop(): string {
  return colors.apollo("╭" + "─".repeat(BOX_WIDTH - 2) + "╮");
}

export function inputBoxBottom(): string {
  return colors.apollo("╰" + "─".repeat(BOX_WIDTH - 2) + "╯");
}

export function inputBoxHint(): string {
  return colors.dim(
    "  /help · /clear · /regenerate · /save · /exit",
  );
}

export function prompt(): string {
  return colors.apollo("│ ") + chalk.bold.hex(APOLLO_LIGHT)("❯ ");
}

export function greeting(line: string): string {
  return colors.apolloLight.bold(line);
}

export function info(msg: string): string {
  return colors.dim(msg);
}

export function error(msg: string): string {
  return colors.error(msg);
}

export function warning(msg: string): string {
  return colors.warning(msg);
}

export function dim(msg: string): string {
  return colors.dim(msg);
}

export function separator(): string {
  return colors.apolloDim("─".repeat(BOX_WIDTH));
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
    process.stdout.write(colors.apollo(`◆ ${line}…\n`));
    return { stop: () => {} };
  }
  process.stdout.write("\x1b[?25l");
  const render = () => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length] ?? "·";
    process.stdout.write(`\r${colors.apollo(frame)} ${colors.dim(line + "…")}   `);
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
      for (const ch of chunk) {
        if (atLineStart) {
          buf += colors.apollo("│ ");
          atLineStart = false;
          started = true;
        }
        buf += ch === "\n" ? "" : colors.text(ch);
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
  process.stdout.write(colors.text(token));
}

export function renderMarkdown(md: string): string {
  return String(marked.parse(md, { async: false }));
}

export function printRenderedMarkdown(md: string): void {
  process.stdout.write(renderMarkdown(md));
}
