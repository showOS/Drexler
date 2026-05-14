import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname } from "node:path";

interface LockRecord {
  pid: number;
  token: string;
  createdAt: number;
  hostname: string;
}

export const FILE_LOCK_TTL_MS = 15_000;

function readLockRecord(lockPath: string): LockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockRecord>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.hostname === "string"
    ) {
      return {
        pid: parsed.pid,
        token: parsed.token,
        createdAt: parsed.createdAt,
        hostname: parsed.hostname,
      };
    }
  } catch {
    // Fall back to mtime staleness when the lock is malformed or unreadable.
  }
  return null;
}

function lockCreatedAt(lockPath: string, record: LockRecord | null): number {
  if (record) return record.createdAt;
  try {
    return statSync(lockPath).mtimeMs;
  } catch {
    return Date.now();
  }
}

function isPidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function shouldBreakLock(lockPath: string): boolean {
  const record = readLockRecord(lockPath);
  if (Date.now() - lockCreatedAt(lockPath, record) > FILE_LOCK_TTL_MS) return true;
  return record !== null && !isPidAlive(record.pid);
}

function releaseOwnedLock(lockPath: string, token: string): void {
  try {
    if (readLockRecord(lockPath)?.token === token) unlinkSync(lockPath);
  } catch {
    // best-effort
  }
}

function acquireLock(target: string): { fd: number; token: string } | null {
  const lockPath = `${target}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID();
    let fd: number;
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch {
      if (attempt === 0 && shouldBreakLock(lockPath)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // raced by another process
        }
      }
      return null;
    }
    try {
      writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, token, createdAt: Date.now(), hostname: hostname() }),
      );
      return { fd, token };
    } catch {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
      releaseOwnedLock(lockPath, token);
      return null;
    }
  }
  return null;
}

export function withJsonFileLock<T>(
  target: string,
  fallback: T,
  update: (current: T) => T,
): boolean {
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lock = acquireLock(target);
  if (!lock) return false;
  const lockPath = `${target}.lock`;
  try {
    let current = fallback;
    try {
      if (existsSync(target)) current = JSON.parse(readFileSync(target, "utf8")) as T;
    } catch {
      current = fallback;
    }
    const next = update(current);
    const tmp = `${target}.tmp.${process.pid}.${randomUUID()}`;
    try {
      writeFileSync(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, target);
      return true;
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort
      }
      return false;
    }
  } finally {
    try {
      closeSync(lock.fd);
    } catch {
      // best-effort
    }
    releaseOwnedLock(lockPath, lock.token);
  }
}
