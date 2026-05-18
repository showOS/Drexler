import { describe, expect, test } from "bun:test";
import { buildOutboundMessages, isVisionCapable, MODEL_CAPS, streamChat } from "../src/llm.ts";
import { loadAttachmentFromBuffer } from "../src/attach/loader.ts";
import type { Attachment } from "../src/attach/types.ts";

function makeText(name = "f.md"): Attachment {
  const r = loadAttachmentFromBuffer(Buffer.from("hello body", "utf-8"), name);
  if (!r.ok) throw new Error("text fixture failed");
  return r.value;
}

function makePng(): Attachment {
  const buf = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
  ]);
  const r = loadAttachmentFromBuffer(buf, "p.png");
  if (!r.ok) throw new Error("png fixture failed");
  return r.value;
}

describe("isVisionCapable", () => {
  test("Gemma aliases are non-vision", () => {
    expect(isVisionCapable("google/gemma-4-31b-it")).toBe(false);
    expect(isVisionCapable("google/gemma-4-26b-a4b-it")).toBe(false);
  });

  test("known multimodal models flagged", () => {
    expect(isVisionCapable("openai/gpt-4o")).toBe(true);
    expect(isVisionCapable("anthropic/claude-3.5-sonnet")).toBe(true);
    expect(isVisionCapable("google/gemini-2.5-pro")).toBe(true);
  });

  test("unknown vendor model with vision hint matches by pattern", () => {
    expect(isVisionCapable("meta-llama/llama-3.2-90b-vision-instruct")).toBe(true);
    expect(isVisionCapable("openai/gpt-4o-2024-08-06")).toBe(true);
  });

  test("unknown text-only model defaults to non-vision", () => {
    expect(isVisionCapable("vendor/text-only-1")).toBe(false);
  });

  test("registry covers expected ids", () => {
    expect(MODEL_CAPS["google/gemma-4-31b-it"]).toEqual({ vision: false });
  });
});

describe("buildOutboundMessages — V72 back-compat", () => {
  test("no attachments → string-content (identity shape)", () => {
    const out = buildOutboundMessages([{ role: "user", content: "hi" }], []);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  test("text attachment inlines as fenced block on last user message", () => {
    const att = makeText();
    const out = buildOutboundMessages([{ role: "user", content: "hi" }], [att]);
    expect(out).toHaveLength(1);
    expect(typeof out[0]!.content).toBe("string");
    expect(out[0]!.content as string).toContain("filename=f.md");
    expect(out[0]!.content as string).toContain("hello body");
  });

  test("image attachment switches to content-array form", () => {
    const png = makePng();
    const out = buildOutboundMessages([{ role: "user", content: "describe" }], [png]);
    const content = out[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0]?.type).toBe("text");
    expect(content[1]?.type).toBe("image_url");
    if (content[1]?.type === "image_url") {
      expect(content[1].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  test("mixed text + image: text block folded into text part, image as image_url", () => {
    const text = makeText();
    const png = makePng();
    const out = buildOutboundMessages([{ role: "user", content: "look" }], [text, png]);
    const content = out[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.length).toBe(2);
    if (content[0]?.type === "text") {
      expect(content[0].text).toContain("look");
      expect(content[0].text).toContain("filename=f.md");
    }
  });

  test("no user messages → no-op", () => {
    const out = buildOutboundMessages([{ role: "system", content: "sys" }], [makePng()]);
    expect(out).toEqual([{ role: "system", content: "sys" }]);
  });
});

describe("streamChat vision gate — V71", () => {
  test("image attachment + non-vision model refuses pre-flight (no HTTP)", async () => {
    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response("");
    };
    const r = await streamChat({
      apiKey: "sk-or-fake",
      model: "google/gemma-4-31b-it",
      messages: [{ role: "user", content: "look" }],
      attachments: [makePng()],
      onToken: () => {},
      fetchFn,
    });
    expect(fetchCalled).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.visionRequired).toBe(true);
    expect(r.error).toContain("VISION_REQUIRED");
  });

  test("text attachment + non-vision model passes vision gate (fetch invoked)", async () => {
    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response("not-real-stream", { status: 500 });
    };
    await streamChat({
      apiKey: "sk-or-fake",
      model: "google/gemma-4-31b-it",
      messages: [{ role: "user", content: "hi" }],
      attachments: [makeText()],
      onToken: () => {},
      fetchFn,
    });
    expect(fetchCalled).toBe(true);
  });
});
