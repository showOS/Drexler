import { describe, expect, test } from "bun:test";
import {
  defaultPersonaPath,
  parseFlags,
  resolveModel,
} from "../src/config.ts";
import { MODEL_FALLBACK, MODEL_PRIMARY } from "../src/types.ts";

describe("parseFlags", () => {
  test("parses --model alias (space form)", () => {
    expect(parseFlags(["--model", "26b"])).toEqual({ model: "26b" });
  });

  test("parses --model=value", () => {
    expect(parseFlags(["--model=31b"])).toEqual({ model: "31b" });
  });

  test("parses --persona path", () => {
    expect(parseFlags(["--persona", "/tmp/x.md"])).toEqual({
      persona: "/tmp/x.md",
    });
  });

  test("parses both flags together", () => {
    expect(parseFlags(["--model", "26b", "--persona=/p/x.md"])).toEqual({
      model: "26b",
      persona: "/p/x.md",
    });
  });

  test("ignores unknown flags", () => {
    expect(parseFlags(["--unknown", "x"])).toEqual({});
  });
});

describe("resolveModel", () => {
  test("alias 31b → primary", () => {
    expect(resolveModel("31b")).toBe(MODEL_PRIMARY);
  });

  test("alias 26b → fallback", () => {
    expect(resolveModel("26b")).toBe(MODEL_FALLBACK);
  });

  test("vendor/name:tag passes through", () => {
    expect(resolveModel("google/gemma-4-31b-it:free")).toBe(
      "google/gemma-4-31b-it:free",
    );
  });

  test("vendor/name without tag passes", () => {
    expect(resolveModel("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  test("unknown shape throws (V12)", () => {
    expect(() => resolveModel("just-a-name")).toThrow(/Unknown model/);
  });

  test("empty string throws", () => {
    expect(() => resolveModel("")).toThrow(/Unknown model/);
  });
});

describe("defaultPersonaPath", () => {
  test("ends with prompts/drexler.md", () => {
    expect(defaultPersonaPath()).toMatch(/prompts\/drexler\.md$/);
  });

  test("is absolute", () => {
    expect(defaultPersonaPath().startsWith("/")).toBe(true);
  });
});
