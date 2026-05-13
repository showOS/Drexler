import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractGreetings, loadPersona, pickGreeting } from "../src/persona.ts";

const FIXTURE = `# Persona

## Drexler's Signature Lines

### Greetings & Session Openers
- "Hello one!"
- "Hello two!"
- "Hello three!"

### General Wisdom
- "Some wisdom"
`;

describe("extractGreetings", () => {
  test("parses bullet list under heading", () => {
    expect(extractGreetings(FIXTURE)).toEqual(["Hello one!", "Hello two!", "Hello three!"]);
  });

  test("stops at next heading", () => {
    const greetings = extractGreetings(FIXTURE);
    expect(greetings).not.toContain("Some wisdom");
  });

  test("returns empty when heading missing", () => {
    expect(extractGreetings("# Other\nstuff\n")).toEqual([]);
  });
});

describe("loadPersona", () => {
  test("throws on missing file (V6)", async () => {
    await expect(loadPersona("/no/such/path.md")).rejects.toThrow(/Failed to load persona/);
  });

  test("returns systemPrompt and greetings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drexler-"));
    const path = join(dir, "p.md");
    try {
      await writeFile(path, FIXTURE, "utf-8");
      const p = await loadPersona(path);
      expect(p.systemPrompt).toBe(FIXTURE);
      expect(p.greetings.length).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to default greeting if list empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drexler-"));
    const path = join(dir, "p.md");
    try {
      await writeFile(path, "# no greetings here", "utf-8");
      const p = await loadPersona(path);
      expect(p.greetings.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("pickGreeting (V13)", () => {
  test("returns one of provided greetings", () => {
    const list = ["a", "b", "c"];
    const picked = pickGreeting(list);
    expect(list).toContain(picked);
  });

  test("returns fallback when list empty", () => {
    expect(pickGreeting([]).length).toBeGreaterThan(0);
  });
});
