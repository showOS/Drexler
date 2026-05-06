export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export const MODEL_PRIMARY = "google/gemma-4-31b-it";
export const MODEL_FALLBACK = "google/gemma-4-26b-a4b-it";

export type ModelAlias = "31b" | "26b";

export interface Config {
  apiKey: string;
  model: string;
  maxHistory: number;
  personaPath: string;
}

export interface PersonaData {
  systemPrompt: string;
  greetings: string[];
}

export interface CliFlags {
  model?: string;
  persona?: string;
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
