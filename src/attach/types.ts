// Attachments — in-memory only per session. §V68/V69/V73.
//
// Single source of truth for the attachment shape, allowlists, and size caps.
// Loader (`./loader.ts`) enforces these; UI + llm consume them.

export type AttachmentKind = "text" | "image";

export interface Attachment {
  kind: AttachmentKind;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  payload: Buffer;
}

export type AttachErrorCode =
  | "not_found"
  | "not_regular_file"
  | "symlink_rejected"
  | "path_traversal"
  | "deny_listed"
  | "ext_not_allowed"
  | "mime_not_allowed"
  | "too_large"
  | "empty_file"
  | "read_failed";

export interface AttachError {
  code: AttachErrorCode;
  message: string;
  path?: string;
}

export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
export const BRACKETED_PASTE_INLINE_LIMIT = 4 * 1024;

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".sh",
  ".toml",
  ".csv",
  ".log",
]);

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export const TEXT_MIME_PREFIXES: readonly string[] = [
  "text/",
  "application/json",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/xml",
];

export const IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Deny-list bases (resolved against $HOME). `.env*` matched by basename.
export const DENY_LIST_DIRS: readonly string[] = [".ssh", ".aws", ".config/drexler"];
export const DENY_BASENAME_PREFIXES: readonly string[] = [".env"];

export function isTextMime(mime: string): boolean {
  return TEXT_MIME_PREFIXES.some((p) => mime === p || mime.startsWith(p));
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

export function capForKind(kind: AttachmentKind): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
}

export function isResult<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok === true;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
