export type NotificationKind =
  | "event"
  | "deal"
  | "synergy"
  | "promotion"
  | "badge"
  | "world"
  | "boss"
  | "streak"
  | "challenge"
  | "perk"
  | "archetype"
  | "minigame";

export interface NotificationEntry {
  at: number;
  kind: NotificationKind;
  message: string;
}

const LOG_CAP = 30;
const log: NotificationEntry[] = [];

export function appendNotification(
  kind: NotificationKind,
  message: string,
  now: number = Date.now(),
): NotificationEntry {
  const entry: NotificationEntry = { at: now, kind, message };
  log.push(entry);
  while (log.length > LOG_CAP) log.shift();
  return entry;
}

export function getNotifications(): ReadonlyArray<NotificationEntry> {
  return log.slice();
}

export function clearNotifications(): void {
  log.length = 0;
}

export function notificationLogSize(): number {
  return log.length;
}

export function formatNotificationLog(limit: number = 20): string {
  if (log.length === 0) return "Pet notification log empty.";
  const tail = log.slice(Math.max(0, log.length - limit));
  const lines = ["Recent pet notifications:"];
  for (let i = tail.length - 1; i >= 0; i--) {
    const entry = tail[i]!;
    const ts = new Date(entry.at).toLocaleTimeString();
    lines.push(`  [${ts}] ${entry.kind} · ${entry.message}`);
  }
  return lines.join("\n");
}
