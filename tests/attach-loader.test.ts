import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildImageDataUrl,
  buildTextAttachmentBlock,
  loadAttachment,
  loadAttachmentFromBuffer,
  shortSha,
} from "../src/attach/loader.ts";
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "../src/attach/types.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drexler-attach-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pngBuffer(): Buffer {
  // Minimal 1x1 png; valid magic header is what the sniffer checks.
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
  ]);
}

describe("loadAttachment path safety", () => {
  test("rejects non-existent path", async () => {
    const r = await loadAttachment(join(dir, "nope.txt"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  test("rejects symlink", async () => {
    const target = join(dir, "real.txt");
    await fs.writeFile(target, "hi", "utf-8");
    const link = join(dir, "link.txt");
    await fs.symlink(target, link);
    const r = await loadAttachment(link);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("symlink_rejected");
  });

  test("rejects path traversal", async () => {
    const path = join(dir, "..", "..", "etc", "passwd");
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["path_traversal", "deny_listed", "not_found"]).toContain(r.error.code);
  });

  test("rejects deny-listed ~/.ssh", async () => {
    await fs.mkdir(join(dir, ".ssh"), { recursive: true });
    await fs.writeFile(join(dir, ".ssh", "id_rsa"), "secret", "utf-8");
    const r = await loadAttachment(join(dir, ".ssh", "id_rsa"), { homeDir: dir });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("deny_listed");
  });

  test("rejects .env basename", async () => {
    const path = join(dir, ".env");
    await fs.writeFile(path, "API_KEY=secret", "utf-8");
    const r = await loadAttachment(path, { homeDir: dir });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("deny_listed");
  });

  test("rejects .env.local basename", async () => {
    const path = join(dir, ".env.local");
    await fs.writeFile(path, "X=1", "utf-8");
    const r = await loadAttachment(path, { homeDir: dir });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("deny_listed");
  });
});

describe("loadAttachment size + mime", () => {
  test("accepts small text file", async () => {
    const path = join(dir, "note.md");
    await fs.writeFile(path, "# hello\n", "utf-8");
    const r = await loadAttachment(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("text");
      expect(r.value.mime).toBe("text/markdown");
      expect(r.value.filename).toBe("note.md");
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  test("accepts png by magic bytes", async () => {
    const path = join(dir, "pixel.png");
    await fs.writeFile(path, pngBuffer());
    const r = await loadAttachment(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("image");
      expect(r.value.mime).toBe("image/png");
    }
  });

  test("rejects empty file", async () => {
    const path = join(dir, "empty.txt");
    await fs.writeFile(path, "");
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty_file");
  });

  test("rejects disallowed extension", async () => {
    const path = join(dir, "bin.exe");
    await fs.writeFile(path, "MZ\x00\x00fake");
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ext_not_allowed");
  });

  test("rejects text over cap", async () => {
    const path = join(dir, "huge.txt");
    await fs.writeFile(path, "a".repeat(MAX_TEXT_BYTES + 1));
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_large");
  });

  test("rejects image over cap (pre-read stat check)", async () => {
    const path = join(dir, "huge.png");
    const big = Buffer.concat([pngBuffer(), Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    await fs.writeFile(path, big);
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_large");
  });

  test("rejects text file containing NUL", async () => {
    const path = join(dir, "binary.txt");
    await fs.writeFile(path, Buffer.from("hi\x00there"));
    const r = await loadAttachment(path);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("mime_not_allowed");
  });
});

describe("loadAttachmentFromBuffer", () => {
  test("accepts text buffer", () => {
    const r = loadAttachmentFromBuffer(Buffer.from("hello world", "utf-8"), "paste.txt");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("text");
      expect(r.value.sizeBytes).toBe(11);
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  test("rejects empty buffer", () => {
    const r = loadAttachmentFromBuffer(Buffer.alloc(0), "x.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty_file");
  });

  test("rejects oversized buffer", () => {
    const buf = Buffer.alloc(MAX_TEXT_BYTES + 1, 65);
    const r = loadAttachmentFromBuffer(buf, "huge.txt", "text/plain");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_large");
  });

  test("accepts png from buffer", () => {
    const r = loadAttachmentFromBuffer(pngBuffer(), "p.png");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("image");
  });
});

describe("formatting helpers", () => {
  test("buildTextAttachmentBlock encodes filename/size/sha", () => {
    const r = loadAttachmentFromBuffer(Buffer.from("body", "utf-8"), "f.md");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const block = buildTextAttachmentBlock(r.value);
    expect(block).toContain("filename=f.md");
    expect(block).toContain("size=4");
    expect(block).toContain(`sha256=${r.value.sha256.slice(0, 8)}`);
    expect(block).toContain("body");
  });

  test("buildImageDataUrl emits data URL", () => {
    const r = loadAttachmentFromBuffer(pngBuffer(), "p.png");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const url = buildImageDataUrl(r.value);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  test("shortSha is 8 chars", () => {
    const r = loadAttachmentFromBuffer(Buffer.from("x"), "x.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(shortSha(r.value)).toHaveLength(8);
  });
});
