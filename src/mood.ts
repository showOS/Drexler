export const MOODS = [
  "angry",
  "generous",
  "paranoid",
  "victorious",
  "exhausted",
  "manic",
] as const;

export type Mood = (typeof MOODS)[number];

export function pickMood(): Mood {
  const i = Math.floor(Math.random() * MOODS.length);
  return MOODS[i] ?? "manic";
}

export function moodLine(mood: Mood): string {
  return `\n\n---\n\nToday's Drexler mood: **${mood}**. All responses colored by this mood. Stay in character; let the mood tilt word choice and energy without becoming a different persona.`;
}
