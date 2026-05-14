import { describe, expect, test } from "bun:test";
import { Conversation } from "../src/conversation.ts";

describe("Conversation (V1, V2, V16)", () => {
  test("V1: system message at index 0 after creation", () => {
    const c = new Conversation("SYS", 10);
    const snap = c.snapshot();
    expect(snap[0]).toEqual({ role: "system", content: "SYS" });
    expect(c.length).toBe(0);
  });

  test("V1: system stays at index 0 after pushes", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    expect(c.snapshot()[0]?.role).toBe("system");
  });

  test("push appends in order", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    const snap = c.snapshot();
    expect(snap[1]).toEqual({ role: "user", content: "u1" });
    expect(snap[2]).toEqual({ role: "assistant", content: "a1" });
  });

  test("V2: trim drops oldest non-system when over cap", () => {
    const c = new Conversation("SYS", 4); // system + 3 turns max
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.push("user", "u2");
    c.push("assistant", "a2"); // overflow, drop u1
    const snap = c.snapshot();
    expect(snap.map((m) => m.content)).toEqual(["SYS", "u2", "a2"]);
  });

  test("trim does not leave an orphan assistant at the start of history", () => {
    const c = new Conversation("SYS", 3);
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.push("user", "u2");
    expect(c.snapshot().map((m) => m.content)).toEqual(["SYS", "u2"]);
  });

  test("V2: system never trimmed even under heavy overflow", () => {
    const c = new Conversation("SYS", 3);
    for (let i = 0; i < 100; i++) c.push("user", `u${i}`);
    const snap = c.snapshot();
    expect(snap[0]?.content).toBe("SYS");
    expect(snap.length).toBe(3);
  });

  test("V16: clear keeps system, drops history", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.clear();
    const snap = c.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]?.content).toBe("SYS");
    expect(c.length).toBe(0);
  });

  test("snapshot returns a copy (mutating it does not affect history)", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    const snap = c.snapshot();
    snap.push({ role: "user", content: "evil" });
    expect(c.snapshot().length).toBe(2);
  });

  test("rejects maxHistory < 3", () => {
    expect(() => new Conversation("SYS", 2)).toThrow();
    expect(() => new Conversation("SYS", 1)).toThrow();
  });

  test("popLastAssistant drops trailing assistant", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    expect(c.popLastAssistant()).toBe(true);
    const snap = c.snapshot();
    expect(snap.length).toBe(2);
    expect(snap[snap.length - 1]?.role).toBe("user");
  });

  test("popLastAssistant returns false when last is user", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    expect(c.popLastAssistant()).toBe(false);
  });

  test("popLastUser drops trailing user and decrements userTurns", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    expect(c.userTurns).toBe(1);
    expect(c.popLastUser()).toBe(true);
    expect(c.length).toBe(0);
    expect(c.userTurns).toBe(0);
  });

  test("popLastUser returns false when last is assistant", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    expect(c.popLastUser()).toBe(false);
    expect(c.length).toBe(2);
    expect(c.userTurns).toBe(1);
  });

  test("popLastUser on empty conversation returns false", () => {
    const c = new Conversation("SYS", 10);
    expect(c.popLastUser()).toBe(false);
    expect(c.userTurns).toBe(0);
  });

  test("lastUserMessage returns most recent user content", () => {
    const c = new Conversation("SYS", 10);
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.push("user", "u2");
    c.push("assistant", "a2");
    expect(c.lastUserMessage()).toBe("u2");
  });

  test("lastUserMessage returns null when no user msg", () => {
    const c = new Conversation("SYS", 10);
    expect(c.lastUserMessage()).toBeNull();
  });

  test("userTurns counts user pushes only", () => {
    const c = new Conversation("SYS", 50);
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.push("user", "u2");
    expect(c.userTurns).toBe(2);
  });

  test("clear resets userTurns counter", () => {
    const c = new Conversation("SYS", 50);
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.clear();
    expect(c.userTurns).toBe(0);
  });

  test("trim preserves userTurns as submitted-turn cadence", () => {
    const c = new Conversation("SYS", 4); // system + 3 turns max
    c.push("user", "u1");
    c.push("assistant", "a1");
    c.push("user", "u2");
    expect(c.userTurns).toBe(2);
    c.push("assistant", "a2"); // overflow → evict u1 + a1
    expect(c.snapshot().map((m) => m.content)).toEqual(["SYS", "u2", "a2"]);
    expect(c.userTurns).toBe(2);
  });

  test("trim does not pin userTurns to retained history size", () => {
    const c = new Conversation("SYS", 5); // system + 4 turns max
    for (let i = 0; i < 10; i++) {
      c.push("user", `u${i}`);
      c.push("assistant", `a${i}`);
    }
    const snap = c.snapshot();
    const userCount = snap.filter((m) => m.role === "user").length;
    expect(userCount).toBeLessThan(c.userTurns);
    expect(c.userTurns).toBe(10);
  });

  test("trim preserves latest complete pairs without orphaning an assistant", () => {
    const c = new Conversation("SYS", 6);
    for (let i = 1; i <= 6; i++) {
      c.push("user", `u${i}`);
      c.push("assistant", `a${i}`);
    }

    expect(c.snapshot().map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:SYS",
      "user:u5",
      "assistant:a5",
      "user:u6",
      "assistant:a6",
    ]);
    expect(c.userTurns).toBe(6);
  });
});
