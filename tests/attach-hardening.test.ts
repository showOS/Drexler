import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { loadAttachment, loadAttachmentFromBuffer } from "../src/attach/loader.ts";
import {
  loadRecent,
  loadRecentValid,
  MAX_RECENT_ENTRIES,
  pushRecent,
} from "../src/attach/recent.ts";
import { disableBracketedPaste, enableBracketedPaste } from "../src/attach/bracketedPaste.ts";

let dir: string;
let origHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drexler-attach-hard-"));
  origHome = process.env.HOME;
  process.env.HOME = dir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  await rm(dir, { recursive: true, force: true });
});

describe("loader hardening — non-regular files (V68)", () => {
  test("rejects FIFO (named pipe)", async () => {
    const fifo = join(dir, "p.txt");
    // Skip on Windows where mkfifo is unavailable.
    try {
      execSync(`mkfifo "${fifo}"`, { stdio: "ignore" });
    } catch {
      return;
    }
    try {
      const r = await loadAttachment(fifo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_regular_file");
    } finally {
      await fs.unlink(fifo).catch(() => {});
    }
  });
});

describe("concurrent attach race", () => {
  test("two parallel loadAttachment calls both succeed without state corruption", async () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    await fs.writeFile(a, "alpha");
    await fs.writeFile(b, "beta");
    const [ra, rb] = await Promise.all([loadAttachment(a), loadAttachment(b)]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.value.sha256).not.toBe(rb.value.sha256);
    }
  });

  test("ten parallel loadAttachmentFromBuffer calls produce distinct attachments", () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      loadAttachmentFromBuffer(Buffer.from(`payload-${i}`, "utf-8"), `p${i}.txt`),
    );
    const shas = new Set<string>();
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) shas.add(r.value.sha256);
    }
    expect(shas.size).toBe(10);
  });
});

describe("recent-files cache (V77)", () => {
  test("round-trips paths in newest-first order", () => {
    expect(loadRecent()).toEqual([]);
    pushRecent("/tmp/one.png");
    pushRecent("/tmp/two.png");
    pushRecent("/tmp/three.png");
    expect(loadRecent()).toEqual(["/tmp/three.png", "/tmp/two.png", "/tmp/one.png"]);
  });

  test("deduplicates on re-push", () => {
    pushRecent("/tmp/one.png");
    pushRecent("/tmp/two.png");
    pushRecent("/tmp/one.png");
    expect(loadRecent()).toEqual(["/tmp/one.png", "/tmp/two.png"]);
  });

  test("caps at MAX_RECENT_ENTRIES", () => {
    for (let i = 0; i < MAX_RECENT_ENTRIES + 5; i++) {
      pushRecent(`/tmp/file-${i}.png`);
    }
    expect(loadRecent()).toHaveLength(MAX_RECENT_ENTRIES);
    expect(loadRecent()[0]).toBe(`/tmp/file-${MAX_RECENT_ENTRIES + 4}.png`);
  });

  test("loadRecentValid drops paths that no longer resolve to regular file", async () => {
    const present = join(dir, "real.txt");
    await fs.writeFile(present, "content");
    pushRecent("/nonexistent/ghost.txt");
    pushRecent(present);
    const valid = loadRecentValid();
    expect(valid).toEqual([present]);
  });

  test("tolerates missing file (empty array)", async () => {
    await rm(join(dir, ".drexler"), { recursive: true, force: true });
    expect(loadRecent()).toEqual([]);
  });
});

describe("bracketed-paste toggle (V74)", () => {
  test("enable/disable swallow non-TTY no-op", () => {
    // process.stdout in bun test is typically non-TTY; both calls must
    // be safe regardless and never throw.
    expect(() => enableBracketedPaste()).not.toThrow();
    expect(() => disableBracketedPaste()).not.toThrow();
  });
});
