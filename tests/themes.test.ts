import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  THEMES,
  buildChalkColors,
  getActiveTheme,
  selectTheme,
  setActiveTheme,
} from "../src/ui/themes.ts";

describe("selectTheme priority", () => {
  let origNoColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
    else delete process.env.NO_COLOR;
  });

  test("flag wins over env and config", () => {
    expect(selectTheme({ flag: "plasma", env: "mono", configValue: "apollo" })).toBe("plasma");
  });

  test("env wins over config when no flag", () => {
    expect(selectTheme({ env: "midnight", configValue: "apollo" })).toBe("midnight");
  });

  test("config used when no flag/env", () => {
    expect(selectTheme({ configValue: "dealroom" })).toBe("dealroom");
  });

  test("default is apollo when nothing supplied", () => {
    expect(selectTheme({})).toBe("apollo");
  });
});

describe("theme registry", () => {
  test("contains the launch/config theme pack", () => {
    expect(Object.keys(THEMES).sort()).toEqual(
      ["amber", "apollo", "dealroom", "midnight", "mono", "paper", "plasma", "terminal"].sort(),
    );
  });

  test("new premium themes have required color slots", () => {
    for (const name of ["terminal", "dealroom", "midnight", "paper", "plasma"] as const) {
      expect(THEMES[name].primary).toBeTruthy();
      expect(THEMES[name].primaryLight).toBeTruthy();
      expect(THEMES[name].primaryDim).toBeTruthy();
      expect(THEMES[name].text).toBeTruthy();
      expect(THEMES[name].dim).toBeTruthy();
      expect(THEMES[name].error).toBeTruthy();
      expect(THEMES[name].warning).toBeTruthy();
    }
  });
});

describe("selectTheme NO_COLOR handling", () => {
  let origNoColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
  });

  afterEach(() => {
    if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
    else delete process.env.NO_COLOR;
  });

  test("NO_COLOR=1 forces mono regardless of flag", () => {
    process.env.NO_COLOR = "1";
    expect(selectTheme({ flag: "amber", env: "apollo", configValue: "apollo" })).toBe("mono");
  });

  test('NO_COLOR="" (empty) does NOT force mono', () => {
    process.env.NO_COLOR = "";
    expect(selectTheme({ flag: "paper" })).toBe("paper");
  });
});

describe("selectTheme unknown name falls back", () => {
  let origNoColor: string | undefined;
  let origErr: typeof console.error;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    origErr = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
    else delete process.env.NO_COLOR;
    console.error = origErr;
  });

  test("unknown theme name falls back to apollo", () => {
    expect(selectTheme({ flag: "neon" })).toBe("apollo");
  });
});

describe("setActiveTheme + getActiveTheme round-trip", () => {
  afterEach(() => {
    setActiveTheme("apollo");
  });

  test("setActiveTheme updates active theme returned by getActiveTheme", () => {
    setActiveTheme("amber");
    expect(getActiveTheme()).toBe(THEMES.amber);
    setActiveTheme("plasma");
    expect(getActiveTheme()).toBe(THEMES.plasma);
    setActiveTheme("apollo");
    expect(getActiveTheme()).toBe(THEMES.apollo);
  });
});

describe("buildChalkColors", () => {
  test("returns object with all 7 keys", () => {
    const colors = buildChalkColors(THEMES.apollo);
    expect(Object.keys(colors).sort()).toEqual(
      ["apollo", "apolloDim", "apolloLight", "dim", "error", "text", "warning"].sort(),
    );
  });

  test("each value is callable (chalk function)", () => {
    const colors = buildChalkColors(THEMES.mono);
    for (const key of Object.keys(colors) as Array<keyof typeof colors>) {
      expect(typeof colors[key]).toBe("function");
      expect(typeof colors[key]("x")).toBe("string");
    }
  });
});
