import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversation } from "../src/conversation.ts";
import {
  buildSavedSession,
  clearSavedSession,
  describeSession,
  formatSessionAge,
  hasSavedSession,
  loadSavedSession,
  saveSession,
  sessionFilePath,
  type SavedSession,
} from "../src/conversation/persist.ts";

describe("conversation persist", () => {
  let origHome: string | undefined;
  let origXdg: string | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "drexler-persist-"));
    origHome = process.env.HOME;
    origXdg = process.env.XDG_STATE_HOME;
    process.env.HOME = dir;
    delete process.env.XDG_STATE_HOME;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    if (origXdg !== undefined) process.env.XDG_STATE_HOME = origXdg;
    else delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  });

  test("sessionFilePath honors XDG_STATE_HOME", () => {
    process.env.XDG_STATE_HOME = join(dir, "state");
    expect(sessionFilePath()).toBe(join(dir, "state", "drexler", "last-session.json"));
  });

  test("sessionFilePath falls back to ~/.local/state/drexler", () => {
    expect(sessionFilePath()).toBe(join(dir, ".local", "state", "drexler", "last-session.json"));
  });

  test("hasSavedSession returns false on a fresh home", () => {
    expect(hasSavedSession()).toBe(false);
  });

  test("buildSavedSession captures user + assistant body and drops system", () => {
    const conv = new Conversation("SYS PROMPT", 10);
    conv.push("user", "hello");
    conv.push("assistant", "hi");
    const saved = buildSavedSession(conv, "SYS PROMPT", "model-x");
    expect(saved.version).toBe(1);
    expect(saved.systemPrompt).toBe("SYS PROMPT");
    expect(saved.model).toBe("model-x");
    expect(saved.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved.messages[0]?.content).toBe("hello");
  });

  test("saveSession + loadSavedSession round-trip", async () => {
    const conv = new Conversation("SYS", 10);
    conv.push("user", "u1");
    conv.push("assistant", "a1");
    await saveSession(buildSavedSession(conv, "SYS"));
    expect(hasSavedSession()).toBe(true);
    const loaded = loadSavedSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.messages.length).toBe(2);
    expect(loaded!.messages[0]?.role).toBe("user");
    expect(loaded!.messages[0]?.content).toBe("u1");
  });

  test("concurrent saves serialize so the latest call wins", async () => {
    const origNow = Date.now;
    Date.now = () => 123_456_789;
    try {
      const sessions: SavedSession[] = Array.from({ length: 20 }, (_, i) => ({
        version: 1,
        savedAt: i,
        systemPrompt: "SYS",
        messages: [{ role: "user", content: `u${i}` }],
        model: `model-${i}`,
      }));

      await Promise.all(sessions.map((session) => saveSession(session)));

      const loaded = loadSavedSession();
      expect(loaded).not.toBeNull();
      expect(loaded!.savedAt).toBe(19);
      expect(loaded!.messages[0]?.content).toBe("u19");
      expect(loaded!.model).toBe("model-19");
    } finally {
      Date.now = origNow;
    }
  });

  test("loadSavedSession returns null for missing file", () => {
    expect(loadSavedSession()).toBeNull();
  });

  test("loadSavedSession returns null for unknown schema version", async () => {
    const future: SavedSession = {
      version: 999 as 1,
      savedAt: Date.now(),
      systemPrompt: "SYS",
      messages: [],
    };
    const target = sessionFilePath();
    await mkdir(join(dir, ".local", "state", "drexler"), { recursive: true });
    await writeFile(target, JSON.stringify(future));
    expect(loadSavedSession()).toBeNull();
  });

  test("loadSavedSession discards non-Message entries", async () => {
    const target = sessionFilePath();
    await mkdir(join(dir, ".local", "state", "drexler"), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        systemPrompt: "SYS",
        messages: [
          { role: "user", content: "good" },
          { role: "unknown", content: "drop" },
          { role: "assistant" },
          "garbage",
        ],
      }),
    );
    const loaded = loadSavedSession();
    expect(loaded!.messages).toEqual([{ role: "user", content: "good" }]);
  });

  test("clearSavedSession removes the file", async () => {
    const conv = new Conversation("SYS", 10);
    conv.push("user", "u");
    await saveSession(buildSavedSession(conv, "SYS"));
    expect(hasSavedSession()).toBe(true);
    clearSavedSession();
    expect(hasSavedSession()).toBe(false);
  });

  test("buildSavedSession trims to most recent 200 messages", () => {
    const conv = new Conversation("SYS", 10_000);
    for (let i = 0; i < 250; i++) conv.push("user", `u${i}`);
    const saved = buildSavedSession(conv, "SYS");
    expect(saved.messages.length).toBe(200);
    expect(saved.messages[0]?.content).toBe("u50");
    expect(saved.messages[199]?.content).toBe("u249");
  });

  test("describeSession returns latest user + assistant snippets", () => {
    const session: SavedSession = {
      version: 1,
      savedAt: Date.now(),
      systemPrompt: "SYS",
      messages: [
        { role: "user", content: "old" },
        { role: "assistant", content: "first" },
        { role: "user", content: "newer question" },
        { role: "assistant", content: "newer answer" },
      ],
    };
    const preview = describeSession(session);
    expect(preview.messageCount).toBe(4);
    expect(preview.lastUserSnippet).toBe("newer question");
    expect(preview.lastAssistantSnippet).toBe("newer answer");
  });

  test("formatSessionAge buckets time spans", () => {
    const now = 1_000_000_000_000;
    expect(formatSessionAge(now - 5_000, now)).toBe("5s ago");
    expect(formatSessionAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatSessionAge(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatSessionAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});
