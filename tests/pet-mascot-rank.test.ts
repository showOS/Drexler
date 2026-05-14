import { describe, expect, test } from "bun:test";
import { rankTitleVariant } from "../src/ui/pet/MascotScene.tsx";
import type { PetRank } from "../src/pet/petState.ts";

describe("mascot rank variants (V56)", () => {
  test("all ranks produce distinct labels", () => {
    const labels = (["intern", "analyst", "associate", "vp", "md"] as PetRank[]).map((r) =>
      rankTitleVariant(r),
    );
    const set = new Set(labels);
    expect(set.size).toBe(labels.length);
  });

  test("each label has padded spaces for ASCII inset and DREXLER OFFICE anchor", () => {
    const variants: PetRank[] = ["intern", "analyst", "associate", "vp", "md"];
    for (const r of variants) {
      const label = rankTitleVariant(r);
      expect(label.startsWith(" ")).toBe(true);
      expect(label.endsWith(" ")).toBe(true);
      expect(label).toContain("DREXLER OFFICE");
    }
  });

  test("rankTitleVariant is pure (same input = same output)", () => {
    expect(rankTitleVariant("intern")).toBe(rankTitleVariant("intern"));
    expect(rankTitleVariant("md")).toBe(rankTitleVariant("md"));
  });
});
