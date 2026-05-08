import { createContext, useContext, type ReactNode } from "react";
import { getActiveTheme, type Theme } from "./themes.ts";

const ThemeCtx = createContext<Theme>(getActiveTheme());
export function ThemeProvider({ value, children }: { value: Theme; children: ReactNode }) {
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
export function useTheme(): Theme {
  return useContext(ThemeCtx);
}
