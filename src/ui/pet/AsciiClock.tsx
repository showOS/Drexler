// Analog ASCII clock used by the office scene. Pure helpers; no dependencies
// on shared scene primitives.

const CLOCK_WIDTH = 21;
const CLOCK_ROWS = 7;
const CLOCK_CENTER_X = 10;
const CLOCK_CENTER_Y = 3;

function drawHand(cells: string[][], hourPos: number, isLong: boolean): void {
  const h = Math.floor(hourPos) % 12;
  const glyphs: Record<number, string> = {
    0: "│",
    1: "╱",
    2: "╱",
    3: "─",
    4: "╲",
    5: "╲",
    6: "│",
    7: "╱",
    8: "╱",
    9: "─",
    10: "╲",
    11: "╲",
  };
  const glyph = glyphs[h] || "·";

  // Handcrafted offsets for a 21x7 clock. These are stable and aspect-ratio aware.
  const offsets: Record<number, [number, number][]> = {
    0: [[0, -1]],
    1: [[2, -1]],
    2: [[4, -1]],
    3: [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    4: [[4, 1]],
    5: [[2, 1]],
    6: [[0, 1]],
    7: [[-2, 1]],
    8: [[-4, 1]],
    9: [
      [-1, 0],
      [-2, 0],
      [-3, 0],
      [-4, 0],
    ],
    10: [[-4, -1]],
    11: [[-2, -1]],
  };

  const points = offsets[h] || [];
  const limit = isLong ? points.length : Math.max(1, Math.floor(points.length / 2));

  for (let i = 0; i < limit; i++) {
    const [dx, dy] = points[i]!;
    const x = CLOCK_CENTER_X + dx;
    const y = CLOCK_CENTER_Y + dy;
    if (x > 0 && x < CLOCK_WIDTH - 1 && y > 0 && y < CLOCK_ROWS - 1) {
      cells[y]![x] = glyph;
    }
  }
}

function stampClockBorder(cells: string[][]): void {
  for (let x = 0; x < CLOCK_WIDTH; x++) {
    cells[0]![x] = x === 0 ? "╭" : x === CLOCK_WIDTH - 1 ? "╮" : "─";
    cells[CLOCK_ROWS - 1]![x] = x === 0 ? "╰" : x === CLOCK_WIDTH - 1 ? "╯" : "─";
  }
  for (let y = 1; y < CLOCK_ROWS - 1; y++) {
    cells[y]![0] = "│";
    cells[y]![CLOCK_WIDTH - 1] = "│";
  }
}

function stampClockText(cells: string[][], text: string, x: number, y: number): void {
  if (y < 0 || y >= CLOCK_ROWS) return;
  for (let i = 0; i < text.length; i++) {
    const col = x + i;
    if (col < 0 || col >= CLOCK_WIDTH) continue;
    cells[y]![col] = text[i]!;
  }
}

function buildAsciiClockLines(_hour: number, _minute: number): string[] {
  // Freezing time at 09:00 (boardroom opening time).
  // The user requested that hands do not move at all from the standard position.
  const safeHour = 9;
  const safeMinute = 0;
  const cells = Array.from({ length: CLOCK_ROWS }, () =>
    Array.from({ length: CLOCK_WIDTH }, () => " "),
  );

  const hourPos = safeHour % 12;
  const minutePos = Math.floor(safeMinute / 5);

  drawHand(cells, minutePos, true);
  drawHand(cells, hourPos, false);

  stampClockText(cells, "12", 9, 1);
  stampClockText(cells, "9", 5, 3);
  stampClockText(cells, "·", CLOCK_CENTER_X, 3);
  stampClockText(cells, "3", 15, 3);
  stampClockText(cells, "6", CLOCK_CENTER_X, 5);
  stampClockBorder(cells);

  return cells.map((row) => row.join("").padEnd(CLOCK_WIDTH, " ").slice(0, CLOCK_WIDTH));
}

export function clockTimeFromFrame(_frame: number): { hour: number; minute: number } {
  // Always return 09:00 to keep the clock static.
  return {
    hour: 9,
    minute: 0,
  };
}

export function clockFromFrame(frame: number): string {
  // Slow ambient clock — advances roughly one minute every 5 frames.
  const { hour, minute } = clockTimeFromFrame(frame);
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function buildAsciiClock(hour: number, minute: number): string {
  return buildAsciiClockLines(hour, minute).join("\n");
}

export function analogClockLines(frame: number): string[] {
  const { hour, minute } = clockTimeFromFrame(frame);
  return buildAsciiClockLines(hour, minute);
}
