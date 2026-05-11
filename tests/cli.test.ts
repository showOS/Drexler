import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "src", "index.ts");

function run(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const result = Bun.spawnSync(["bun", "run", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, OPENROUTER_API_KEY: "" }, // avoid hitting real config
  });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode,
  };
}

describe("drexler CLI fast paths", () => {
  test("--version prints semver and exits 0", () => {
    const { stdout, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("-v alias works", () => {
    const { stdout, exitCode } = run(["-v"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help prints usage and exits 0", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--persona");
    expect(stdout).toContain("--no-intro");
    expect(stdout).toContain("--fast");
    expect(stdout).toContain("/help");
    expect(stdout).toContain("/exit");
    expect(stdout).toContain("/pet");
    expect(stdout).toContain("/theme");
    expect(stdout).toContain("/startup");
    expect(stdout).toContain("/regenerate");
    expect(stdout).toContain("/redo");
    expect(stdout).toContain("/retry");
    expect(stdout).toContain("/expand");
    expect(stdout).toContain("/quote");
    expect(stdout).toContain("/search");
    expect(stdout).toContain("/export");
    expect(stdout).toContain("/save");
  });

  test("-h alias works", () => {
    const { stdout, exitCode } = run(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  test("--help mentions --theme option", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--theme");
  });

  test("--help mentions fast startup flags", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--no-intro");
    expect(stdout).toContain("--fast");
  });

  test("--version exits before any API key check (works with empty env)", () => {
    const { stderr, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("API key");
    expect(stderr).not.toContain("Drexler notice");
  });

  test("--help mentions /setup and /update", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("/setup");
    expect(stdout).toContain("/update");
  });
});

describe("drexler CLI fail-fast on bad args", () => {
  test("--model garbage exits 1 BEFORE any API key prompt", () => {
    const { stderr, exitCode } = run(["--model", "garbage"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/model alias|Unknown model/i);
    expect(stderr).not.toMatch(/Enter OpenRouter API key/);
    expect(stderr).not.toMatch(/Drexler notice/);
  });

  test("--persona /nonexistent.md exits 1 with persona reason", () => {
    const { stderr, exitCode } = run(["--persona", "/nonexistent-xyzzy-9999.md"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/persona/i);
    expect(stderr).not.toMatch(/Enter OpenRouter API key/);
  });
});
