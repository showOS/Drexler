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

function marketBoardPanelRow(width: number, left: string, center: string, right: string): string {
  const inner = Math.max(1, width - 2);
  const contentWidth = Math.max(1, inner - 2);
  const separator = " │ ";
  const leftWidth = Math.min(32, Math.max(18, Math.floor(contentWidth * 0.3)));
  const rightWidth = Math.min(12, Math.max(9, Math.floor(contentWidth * 0.14)));
  const centerWidth = Math.max(1, contentWidth - leftWidth - rightWidth - separator.length * 2);
  const content = [
    marketBoardCell(left, leftWidth, "left"),
    marketBoardCell(center, centerWidth, "center"),
    marketBoardCell(right, rightWidth, "right"),
  ].join(separator);
  const row = ` ${content} `;
  return boxRowFromInner(width, row);
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
  const candleA = frame % 4 < 2 ? "▐█▌" : "▐░▌";
  const candleB = activity === "praised" ? "▐█▌" : frame % 5 < 3 ? "▐░▌" : "▐█▌";
  const candleC = activity === "working" ? "▐█▌" : "▐░▌";
  const finalCandle = activity === "praised" ? "▐█▌" : frame % 6 < 3 ? "▐█▌" : "▐░▌";
  const fee = Math.max(40, Math.min(99, Math.round((stats.happiness + stats.deals) / 2)));
  const pipe = Math.round(stats.deals);
  const chartLabel = boardTapeLabel(activity, frame);
  const narrow = width < 58;
  const tapeMarker = frame % 2 === 0 ? ">" : "_";
  const chartA = `┄┄┄┄ ${candleA} │`;
  const chartB = `│ ${candleB} │ ${candleC}`;
  const chartC = `${candleB} │ ${finalCandle} │`;

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
