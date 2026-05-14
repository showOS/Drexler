import { readFile } from "node:fs/promises";
import type { PersonaData } from "./types.ts";

const GREETINGS_HEADING = "### Greetings & Session Openers";

export function extractGreetings(md: string): string[] {
  const lines = md.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === GREETINGS_HEADING) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line.trim())) break;
    if (inSection) {
      const m = line.match(/^-\s+"(.+)"\s*$/);
      if (m && m[1]) out.push(m[1]);
    }
  }
  return out;
}

export async function loadPersona(path: string): Promise<PersonaData> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load persona file at ${path}: ${msg}`);
  }
  const greetings = extractGreetings(raw);
  if (greetings.length === 0) {
    greetings.push("Drexler here. Get to point.");
  }
  return { systemPrompt: raw, greetings };
}

export function pickGreeting(greetings: string[]): string {
  if (greetings.length === 0) return "Drexler here. Get to point.";
  const i = Math.floor(Math.random() * greetings.length);
  return greetings[i] ?? greetings[0]!;
}

export interface LazyPersona {
  system: () => Promise<string>;
  openers: () => Promise<string[]>;
  preload: () => void;
}

export function loadPersonaLazy(path: string): LazyPersona {
  let inflight: Promise<PersonaData> | null = null;
  const start = (): Promise<PersonaData> => {
    if (!inflight) inflight = loadPersona(path);
    return inflight;
  };
  return {
    system: async () => (await start()).systemPrompt,
    openers: async () => (await start()).greetings,
    preload: () => {
      // Fire-and-forget. Attach a noop catch so an early rejection
      // before the first awaiter doesn't surface as an unhandled
      // rejection; the real error is still thrown when system() /
      // openers() awaits the same cached promise.
      start().catch(() => {});
    },
  };
}
