import type { Message } from "../types.ts";
import { sanitizeTelemetryText } from "../llm.ts";
import { getPetMood, getPetRank, rankLabel, type PetStats } from "./petState.ts";

export const PET_SUMMARY_PREFIX = "PET STATUS";
export const PET_SUMMARY_MAX_LEN = 200;

// Compact one-liner that gets appended to the system prompt content so
// the persona can react to mood without bloating every model call. We
// reuse `sanitizeTelemetryText` so a future leak of credentials or
// local home paths into the pet state never makes it onto the wire.
export function buildPetSummary(stats: PetStats): string {
  const name = stats.name ? stats.name.slice(0, 24) : "Drexler";
  const mood = getPetMood(stats);
  const rank = rankLabel(getPetRank(stats));
  const summary = `${PET_SUMMARY_PREFIX}: name=${name} mood=${mood} hunger=${Math.round(
    stats.hunger,
  )}% happy=${Math.round(stats.happiness)}% energy=${Math.round(stats.energy)}% rank=${rank}`;
  const sanitized = sanitizeTelemetryText(summary);
  return sanitized.length > PET_SUMMARY_MAX_LEN
    ? sanitized.slice(0, PET_SUMMARY_MAX_LEN - 1) + "…"
    : sanitized;
}

// Append the summary to the system message content (index 0). Never
// inserts a second system message — V1 keeps the system message at
// index 0 and never trims. When pet mode is off we pass `null` and the
// caller skips this step entirely.
export function injectPetSummary(messages: Message[], summary: string | null): Message[] {
  if (!summary || messages.length === 0) return messages;
  const head = messages[0]!;
  if (head.role !== "system") return messages;
  const merged: Message = {
    role: "system",
    content: `${head.content}\n\n${summary}`,
  };
  return [merged, ...messages.slice(1)];
}
