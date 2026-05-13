import type { PetActivity, PetStats } from "../../pet/petState.ts";
import { displayWidth, fitDisplayText } from "../graphemes.ts";
import { clockFromFrame } from "./AsciiClock.tsx";
import {
  activityStatusToken,
  blankRow,
  boxBottom,
  boxContent,
  boxRowFromInner,
  boxTop,
  place,
  placeRight,
} from "./shared.ts";

function marketBoardRow(width: number, left: string, chart: string, axis: string): string {
  const inner = Math.max(1, width - 2);
  let row = blankRow(inner);
  row = placeRight(row, axis, 1);
  const chartX = Math.max(
    18,
    Math.min(inner - displayWidth(axis) - displayWidth(chart) - 3, Math.floor(inner * 0.46)),
  );
  row = place(row, fitDisplayText(left, Math.max(1, chartX - 2)), 1);
  row = place(row, chart, Math.max(1, chartX));
  return boxRowFromInner(width, row);
}

function marketBoardSplitRow(width: number, left: string, right: string): string {
  const inner = Math.max(1, width - 2);
  let row = blankRow(inner);
  const fittedRight = fitDisplayText(right, Math.max(1, inner - 2));
  const rightX = Math.max(0, inner - displayWidth(fittedRight) - 1);
  row = place(row, fitDisplayText(left, Math.max(1, rightX - 2)), 1);
  row = place(row, fittedRight, rightX);
  return boxRowFromInner(width, row);
}

function marketBoardCell(text: string, width: number, align: "left" | "center" | "right"): string {
  const safeWidth = Math.max(1, width);
  const fitted = fitDisplayText(text, safeWidth);
  const padding = Math.max(0, safeWidth - displayWidth(fitted));
  if (align === "right") return `${" ".repeat(padding)}${fitted}`;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    return `${" ".repeat(left)}${fitted}${" ".repeat(padding - left)}`;
  }
  return `${fitted}${" ".repeat(padding)}`;
}

const MARKET_QUOTE_ARROW_COLUMN = 13;

function marketQuote(label: string, change: string, direction: "▲" | "▼" = "▲"): string {
  const safeLabel = fitDisplayText(label, MARKET_QUOTE_ARROW_COLUMN);
  return `${safeLabel}${" ".repeat(
    Math.max(0, MARKET_QUOTE_ARROW_COLUMN - displayWidth(safeLabel)),
  )}${direction} ${change}`;
}

// Width budget mirrored from marketBoardPanelRow so chart cells can be
// generated at the exact width the row will reserve for them — keeps
// the sparkline from being truncated mid-tick.
function panelCellWidths(width: number): {
  leftWidth: number;
  centerWidth: number;
  rightWidth: number;
} {
  const inner = Math.max(1, width - 2);
  const contentWidth = Math.max(1, inner - 2);
  const separator = 3; // " │ "
  const leftWidth = Math.min(32, Math.max(18, Math.floor(contentWidth * 0.3)));
  const rightWidth = Math.min(12, Math.max(9, Math.floor(contentWidth * 0.14)));
  const centerWidth = Math.max(1, contentWidth - leftWidth - rightWidth - separator * 2);
  return { leftWidth, centerWidth, rightWidth };
}

function marketBoardPanelRow(width: number, left: string, center: string, right: string): string {
  const { leftWidth, centerWidth, rightWidth } = panelCellWidths(width);
  const inner = Math.max(1, width - 2);
  const separator = " │ ";
  const content = [
    marketBoardCell(left, leftWidth, "left"),
    marketBoardCell(center, centerWidth, "center"),
    marketBoardCell(right, rightWidth, "right"),
  ].join(separator);
  void inner;
  const row = ` ${content} `;
  return boxRowFromInner(width, row);
}

// ─── sparklines ───────────────────────────────────────────────────────────────

const BAR_CHARS = " ▁▂▃▄▅▆▇█";

// Per-ticker price ladders (values index BAR_CHARS). Length 32 so the
// scroll loops every ~25s at 800ms/frame and the visible window covers
// roughly one full pattern at panel widths around 30.
//
// AAPL ↑1.25%  — gentle uptrend with a midday dip.
// MSFT ↓0.82%  — sustained downtrend, lower lows.
// NVDA ↑2.11%  — steeper uptrend with a plateau at the highs.
const AAPL_SPARK = [
  4, 4, 5, 5, 5, 6, 6, 6, 5, 5, 6, 6, 7, 7, 7, 6, 6, 5, 5, 5, 6, 6, 7, 7, 7, 7, 8, 8, 7, 7, 6, 5,
] as const;
const MSFT_SPARK = [
  7, 7, 7, 6, 6, 6, 5, 5, 6, 6, 5, 5, 4, 4, 4, 5, 4, 4, 3, 3, 3, 4, 3, 3, 2, 2, 2, 3, 2, 2, 1, 1,
] as const;
const NVDA_SPARK = [
  2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 7, 7, 7, 8, 8, 8, 7, 7, 8, 8, 8, 7, 8, 8, 8, 7, 7, 8, 8, 7,
] as const;

function sparkSlice(spark: readonly number[], frame: number, width: number): string {
  if (width <= 0 || spark.length === 0) return "";
  const len = spark.length;
  const start = ((frame % len) + len) % len;
  let out = "";
  for (let i = 0; i < width; i++) {
    const idx = (start + i) % len;
    out += BAR_CHARS[spark[idx] ?? 0];
  }
  return out;
}

export function boardTapeLabel(activity: PetActivity, frame: number): string {
  switch (activity) {
    case "working":
      return frame % 2 === 0 ? "term live" : "keys live";
    case "praised":
      return "memo done";
    case "sleeping":
      return "desk quiet";
    case "eating":
      return "deal snack";
    case "playing":
      return "rally tape";
    case "vibing":
      return "lo-fi tape";
    default:
      return "desk quiet";
  }
}

export function marketBoardLines(
  width: number,
  activity: PetActivity,
  frame: number,
  stats: PetStats,
): string[] {
  const status = activityStatusToken(activity, frame);
  const fee = Math.max(40, Math.min(99, Math.round((stats.happiness + stats.deals) / 2)));
  const pipe = Math.round(stats.deals);
  const chartLabel = boardTapeLabel(activity, frame);
  const narrow = width < 58;
  const tapeMarker = frame % 2 === 0 ? ">" : "_";

  // Cell widths for sparkline generation. Wide path uses the exact center
  // cell width; narrow path uses a smaller fixed slot inside marketBoardRow.
  const { centerWidth } = panelCellWidths(width);
  const narrowSparkWidth = Math.max(8, Math.min(20, Math.max(1, width - 2) - 32));
  const sparkW = narrow ? narrowSparkWidth : centerWidth;
  const chartA = sparkSlice(AAPL_SPARK, frame, sparkW);
  const chartB = sparkSlice(MSFT_SPARK, frame, sparkW);
  const chartC = sparkSlice(NVDA_SPARK, frame, sparkW);

  if (narrow) {
    return [
      boxTop(width, "DREXLER MARKETS"),
      marketBoardSplitRow(width, `DEMO ${clockFromFrame(frame)} ${status}`, `FEE ${fee}%`),
      boxContent(width, ` ${marketQuote(`TAPE${tapeMarker} AAPL`, "1.25")}  MSFT ▼ 0.82`),
      boxContent(width, " BID .8419   ASK .8423   VOL 24K"),
      marketBoardRow(width, marketQuote("AAPL 214", "1.25"), chartA, "220"),
      marketBoardRow(width, marketQuote("MSFT 421", "0.82", "▼"), chartB, "430"),
      boxContent(width, ` OPEN 09:00  ${chartLabel}  PIPE ${pipe}%`),
      boxBottom(width),
    ];
  }

  const headerLeft = marketQuote("DREX 0.8421", "3.17");
  const headerCenter = `DEMO ${clockFromFrame(frame)} ${status}`;
  const footerCenter =
    width < 90 ? `OPEN 09:00  ${chartLabel}` : `OPEN 09:00  13:00  ${chartLabel}  CLOSE 16:00`;
  return [
    boxTop(width, "DREXLER MARKETS"),
    marketBoardPanelRow(width, headerLeft, headerCenter, `FEE ${fee}%`),
    marketBoardPanelRow(width, marketQuote(`TAPE${tapeMarker} AAPL`, "1.25"), "CANDLE", "VOL 24K"),
    marketBoardPanelRow(width, marketQuote("AAPL 214", "1.25"), chartA, "220"),
    marketBoardPanelRow(width, marketQuote("MSFT 421", "0.82", "▼"), chartB, "430"),
    marketBoardPanelRow(width, marketQuote("NVDA 912", "2.11"), chartC, "900"),
    marketBoardPanelRow(width, "BID .8419  ASK .8423", footerCenter, `PIPE ${pipe}%`),
    boxBottom(width),
  ];
}
