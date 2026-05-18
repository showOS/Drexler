import { describe, expect, test } from "bun:test";
import { sanitizeAttachmentBlocks } from "../src/attach/sanitize.ts";
import { buildTextAttachmentBlock, loadAttachmentFromBuffer } from "../src/attach/loader.ts";

describe("sanitizeAttachmentBlocks — V73", () => {
  test("replaces fenced text-attachment block with placeholder", () => {
    const r = loadAttachmentFromBuffer(Buffer.from("hello body line", "utf-8"), "f.md");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const block = buildTextAttachmentBlock(r.value);
    const input = `intro paragraph\n\n${block}\n\nafter`;
    const out = sanitizeAttachmentBlocks(input);
    expect(out).not.toContain("hello body line");
    expect(out).toContain("[attachment: f.md");
    expect(out).toContain(`sha256:${r.value.sha256.slice(0, 8)}`);
    expect(out).toContain("intro paragraph");
    expect(out).toContain("after");
  });

  test("formats bytes in human-readable size", () => {
    const r = loadAttachmentFromBuffer(Buffer.from("a".repeat(2048), "utf-8"), "x.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const block = buildTextAttachmentBlock(r.value);
    const out = sanitizeAttachmentBlocks(block);
    expect(out).toMatch(/\(2\.0KB\)/);
  });

  test("leaves untagged fenced blocks alone", () => {
    const input = "```js\nconst x = 1;\n```";
    const out = sanitizeAttachmentBlocks(input);
    expect(out).toBe(input);
  });

  test("replaces multiple attachment blocks independently", () => {
    const a = loadAttachmentFromBuffer(Buffer.from("aaa", "utf-8"), "a.txt");
    const b = loadAttachmentFromBuffer(Buffer.from("bbb", "utf-8"), "b.txt");
    if (!a.ok || !b.ok) throw new Error("fixture failed");
    const text = `${buildTextAttachmentBlock(a.value)}\n\n${buildTextAttachmentBlock(b.value)}`;
    const out = sanitizeAttachmentBlocks(text);
    expect(out).toContain("[attachment: a.txt");
    expect(out).toContain("[attachment: b.txt");
    expect(out).not.toContain("aaa");
    expect(out).not.toContain("bbb");
  });

  test("image-placeholder lines pass through unchanged", () => {
    const input = "look: [attachment: pic.png (1.2KB) sha256:abcd1234]";
    expect(sanitizeAttachmentBlocks(input)).toBe(input);
  });
});
