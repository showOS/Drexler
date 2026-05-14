import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendNotification,
  clearNotifications,
  formatNotificationLog,
  getNotifications,
  notificationLogSize,
} from "../src/pet/notificationLog.ts";

describe("notification log", () => {
  beforeEach(() => clearNotifications());

  test("appendNotification appends and getNotifications returns snapshot", () => {
    appendNotification("event", "test message", 1000);
    const snap = getNotifications();
    expect(snap.length).toBe(1);
    expect(snap[0]!.message).toBe("test message");
  });

  test("ring buffer caps at 30 entries (V55)", () => {
    for (let i = 0; i < 40; i++) {
      appendNotification("event", `m${i}`, i);
    }
    expect(notificationLogSize()).toBe(30);
    const snap = getNotifications();
    expect(snap[0]!.message).toBe("m10");
    expect(snap.at(-1)!.message).toBe("m39");
  });

  test("getNotifications returns a defensive copy", () => {
    appendNotification("badge", "x", 0);
    const snap = getNotifications() as unknown as { length: number; push: (n: unknown) => void };
    snap.push({ at: 1, kind: "event", message: "leak" } as never);
    expect(notificationLogSize()).toBe(1);
  });

  test("formatNotificationLog renders empty + populated", () => {
    expect(formatNotificationLog()).toContain("empty");
    appendNotification("deal", "Acme closed", 0);
    expect(formatNotificationLog()).toContain("Acme closed");
  });

  test("clearNotifications resets the log", () => {
    appendNotification("event", "a", 0);
    appendNotification("event", "b", 1);
    clearNotifications();
    expect(notificationLogSize()).toBe(0);
  });
});
