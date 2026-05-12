export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export const MODEL_PRIMARY = "google/gemma-4-31b-it";
export const MODEL_FALLBACK = "google/gemma-4-26b-a4b-it";

export const THEME_NAMES = [
  "apollo",
  "amber",
  "mono",
  "terminal",
  "dealroom",
  "midnight",
  "paper",
  "plasma",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export interface Config {
  apiKey: string;
  model: string;
  maxHistory: number;
  personaPath: string;
  theme?: ThemeName;
  noIntro?: boolean;
  fast?: boolean;
}

export interface PersonaData {
  systemPrompt: string;
  greetings: string[];
}

export interface CliFlags {
  model?: string;
  persona?: string;
  theme?: string;
  noIntro?: boolean;
  fast?: boolean;
  resume?: boolean;
}

export interface OpenRouterRequestBody {
  model: string;
  messages: Message[];
  stream: true;
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface StreamChunk {
  choices: Array<{
    delta: { content?: string; role?: Role };
    finish_reason: string | null;
  }>;
}
