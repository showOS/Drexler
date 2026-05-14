import { describe, expect, test } from "bun:test";
import {
  ARCHETYPES,
  archetypeMultipliers,
  chooseArchetype,
  parseArchetype,
  renderArchetypes,
} from "../src/pet/archetype.ts";
import type { PetStats } from "../src/pet/petState.ts";

function baseStats(overrides: Partial<PetStats> = {}): PetStats {
  return {
    hunger: 50,
    happiness: 50,
    energy: 50,
    deals: 50,
    lastSaved: 0,
    ...overrides,
  };
}

describe("archetype", () => {
  test("parseArchetype + ARCHETYPES enumerable", () => {
    expect(ARCHETYPES.length).toBe(3);
    expect(parseArchetype("CLOSER")).toBe("closer");
    expect(parseArchetype("nope")).toBeNull();
  });

  test("chooseArchetype requires VP rank or higher", () => {
    const stats = baseStats();
    const r = chooseArchetype(stats, "closer", 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rank_locked");
  });

  test("chooseArchetype sets when at VP (V61)", () => {
    const r = chooseArchetype(baseStats(), "operator", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.archetype).toBe("operator");
  });

  test("chooseArchetype rejects re-choice (V61 immutability)", () => {
    const stats = baseStats({ archetype: "closer" });
    const r = chooseArchetype(stats, "networker", 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already_set");
  });

  test("archetypeMultipliers reflect each archetype", () => {
    expect(archetypeMultipliers(baseStats({ archetype: "closer" }))).toEqual({
      work: 1.5,
      play: 0.75,
      rest: 1,
      decay: 1,
    });
    expect(archetypeMultipliers(baseStats({ archetype: "networker" }))).toEqual({
      play: 1.5,
      work: 0.75,
      rest: 1,
      decay: 1,
    });
    expect(archetypeMultipliers(baseStats({ archetype: "operator" }))).toEqual({
      rest: 1.5,
      work: 1,
      play: 1,
      decay: 0.9,
    });
    expect(archetypeMultipliers(baseStats())).toEqual({
      work: 1,
      play: 1,
      rest: 1,
      decay: 1,
    });
  });

  test("renderArchetypes shows lock state", () => {
    expect(renderArchetypes(baseStats())).toContain("unset");
    expect(renderArchetypes(baseStats({ archetype: "closer" }))).toContain("locked");
  });
});
