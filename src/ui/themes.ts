import chalk from "chalk";

export interface Theme {
  primary: string;       // e.g. "#007e54" or "green"
  primaryLight: string;
  primaryDim: string;
  text: string;
  dim: string;
  error: string;
  warning: string;
  ansi: boolean;         // true = use named ANSI colors, false = hex
}

export type ThemeName = "apollo" | "amber" | "mono";

export const THEMES: Record<ThemeName, Theme> = {
  apollo: {
    primary: "#007e54", primaryLight: "#00a86b", primaryDim: "#005c3a",
    text: "#e0e0e0", dim: "#6b7280",
    error: "#ef4444", warning: "#eab308",
    ansi: false,
  },
  amber: {
    primary: "#d97706", primaryLight: "#f59e0b", primaryDim: "#92400e",
    text: "#e0e0e0", dim: "#6b7280",
    error: "#ef4444", warning: "#eab308",
    ansi: false,
  },
  mono: {
    primary: "white", primaryLight: "white", primaryDim: "gray",
    text: "white", dim: "gray",
    error: "red", warning: "yellow",
    ansi: true,
  },
};

let active: Theme = THEMES.apollo;

export function setActiveTheme(name: ThemeName): void {
  active = THEMES[name];
}
export function getActiveTheme(): Theme {
  return active;
}

export function selectTheme(opts: {
  flag?: string; env?: string; configValue?: string;
}): ThemeName {
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return "mono";
  const candidate = opts.flag ?? opts.env ?? opts.configValue ?? "apollo";
  if (candidate === "apollo" || candidate === "amber" || candidate === "mono") {
    return candidate;
  }
  console.error(`Unknown theme "${candidate}", falling back to apollo.`);
  return "apollo";
}

export function buildChalkColors(theme: Theme) {
  const wrap = (color: string) => theme.ansi ? (chalk as any)[color] ?? chalk.white : chalk.hex(color);
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
