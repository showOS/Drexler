import { describe, expect, test } from "bun:test";
import {
  PET_SUMMARY_MAX_LEN,
  PET_SUMMARY_PREFIX,
  buildPetSummary,
  injectPetSummary,
} from "../src/pet/personaSummary.ts";
import type { PetStats } from "../src/pet/petState.ts";
import type { Message } from "../src/types.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 70,
    happiness: 60,
    energy: 55,
    deals: 40,
    lastSaved: 0,
    name: "Drex",
    lifetimeDeals: 300,
    ...overrides,
  };
}

describe("pet persona summary", () => {
  test("buildPetSummary includes the canonical prefix", () => {
    expect(buildPetSummary(baseStats())).toContain(PET_SUMMARY_PREFIX);
  });

  test("summary stays within 200 chars", () => {
    const giant = baseStats({ name: "X".repeat(60) });
    expect(buildPetSummary(giant).length).toBeLessThanOrEqual(PET_SUMMARY_MAX_LEN);
  });

  test("summary masks Bearer tokens that slip in via name", () => {
    const dirty = baseStats({ name: "Bearer abcdefghijk" });
    const out = buildPetSummary(dirty);
    expect(out).toContain("[redacted]");
    expect(out.toLowerCase()).not.toContain("abcdefghijk");
  });

  test("injectPetSummary appends to system message content", () => {
    const messages: Message[] = [
      { role: "system", content: "You are Drexler." },
      { role: "user", content: "Hi." },
    ];
    const summary = "PET STATUS: name=Drex mood=operational ...";
    const next = injectPetSummary(messages, summary);
    expect(next.length).toBe(messages.length);
    expect(next[0]!.role).toBe("system");
    expect(next[0]!.content).toContain("You are Drexler.");
    expect(next[0]!.content).toContain(summary);
  });

  test("null summary is a no-op", () => {
    const messages: Message[] = [
      { role: "system", content: "x" },
      { role: "user", content: "y" },
    ];
    const next = injectPetSummary(messages, null);
    expect(next).toBe(messages);
  });

  test("only modifies first message when system", () => {
    const messages: Message[] = [{ role: "user", content: "hello" }];
    const next = injectPetSummary(messages, "PET STATUS: x");
    expect(next).toBe(messages);
  });
});
