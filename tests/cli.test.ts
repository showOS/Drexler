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
    expect(stdout).toContain("/help");
    expect(stdout).toContain("/exit");
    expect(stdout).toContain("/regenerate");
    expect(stdout).toContain("/save");
  });

  test("-h alias works", () => {
    const { stdout, exitCode } = run(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  test("--version exits before any API key check (works with empty env)", () => {
    const { stderr, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("API key");
    expect(stderr).not.toContain("Drexler notice");
  });
});
