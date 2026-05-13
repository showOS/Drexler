import chalk from "chalk";
import { THEME_NAMES, type ThemeName } from "../types.ts";

export interface Theme {
  primary: string; // e.g. "#007e54" or "green"
  primaryLight: string;
  primaryDim: string;
  text: string;
  dim: string;
  error: string;
  warning: string;
  ansi: boolean; // true = use named ANSI colors, false = hex
}

export const THEMES: Record<ThemeName, Theme> = {
  apollo: {
    primary: "#007e54",
    primaryLight: "#00a86b",
    primaryDim: "#005c3a",
    text: "#e0e0e0",
    dim: "#6b7280",
    error: "#ef4444",
    warning: "#eab308",
    ansi: false,
  },
  amber: {
    primary: "#d97706",
    primaryLight: "#f59e0b",
    primaryDim: "#92400e",
    text: "#e0e0e0",
    dim: "#6b7280",
    error: "#ef4444",
    warning: "#eab308",
    ansi: false,
  },
  mono: {
    primary: "white",
    primaryLight: "white",
    primaryDim: "gray",
    text: "white",
    dim: "gray",
    error: "red",
    warning: "yellow",
    ansi: true,
  },
  terminal: {
    primary: "green",
    primaryLight: "cyan",
    primaryDim: "gray",
    text: "white",
    dim: "gray",
    error: "red",
    warning: "yellow",
    ansi: true,
  },
  dealroom: {
    primary: "#0f766e",
    primaryLight: "#14b8a6",
    primaryDim: "#115e59",
    text: "#f3f4f6",
    dim: "#94a3b8",
    error: "#f43f5e",
    warning: "#f59e0b",
    ansi: false,
  },
  midnight: {
    primary: "#38bdf8",
    primaryLight: "#7dd3fc",
    primaryDim: "#0369a1",
    text: "#e5e7eb",
    dim: "#64748b",
    error: "#fb7185",
    warning: "#facc15",
    ansi: false,
  },
  paper: {
    primary: "#1d4ed8",
    primaryLight: "#2563eb",
    primaryDim: "#1e3a8a",
    text: "#f8fafc",
    dim: "#94a3b8",
    error: "#b91c1c",
    warning: "#b45309",
    ansi: false,
  },
  plasma: {
    primary: "#db2777",
    primaryLight: "#f472b6",
    primaryDim: "#7e22ce",
    text: "#f8fafc",
    dim: "#94a3b8",
    error: "#f43f5e",
    warning: "#f59e0b",
    ansi: false,
  },
};

let active: Theme = THEMES.apollo;

export function setActiveTheme(name: ThemeName): void {
  active = THEMES[name];
}
export function getActiveTheme(): Theme {
  return active;
}

export function isThemeName(value: string | undefined): value is ThemeName {
  return THEME_NAMES.includes(value as ThemeName);
}

export function selectTheme(opts: {
  flag?: string;
  env?: string;
  configValue?: string;
}): ThemeName {
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return "mono";
  const candidate = opts.flag ?? opts.env ?? opts.configValue ?? "apollo";
  if (isThemeName(candidate)) {
    return candidate;
  }
  console.error(`Unknown theme "${candidate}", falling back to apollo.`);
  return "apollo";
}

function ansiNamedColor(name: string): typeof chalk.white {
  switch (name) {
    case "black":
      return chalk.black;
    case "red":
      return chalk.red;
    case "green":
      return chalk.green;
    case "yellow":
      return chalk.yellow;
    case "blue":
      return chalk.blue;
    case "magenta":
      return chalk.magenta;
    case "cyan":
      return chalk.cyan;
    case "white":
      return chalk.white;
    case "gray":
    case "grey":
      return chalk.gray;
    default:
      return chalk.white;
  }
}

export function buildChalkColors(theme: Theme) {
  const wrap = (color: string) => (theme.ansi ? ansiNamedColor(color) : chalk.hex(color));
  return {
    apollo: wrap(theme.primary),
    apolloLight: wrap(theme.primaryLight),
    apolloDim: wrap(theme.primaryDim),
    text: wrap(theme.text),
    dim: wrap(theme.dim),
    error: wrap(theme.error),
    warning: wrap(theme.warning),
  };
}
