// Attachment loader. §V68/V69.
//
// stat → deny-list check → size cap → read → sniff → finalize.
// Reads payload only after stat + path checks pass.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  capForKind,
  DENY_BASENAME_PREFIXES,
  DENY_LIST_DIRS,
  IMAGE_EXTENSIONS,
  IMAGE_MIMES,
  isImageMime,
  isTextMime,
  MAX_TEXT_BYTES,
  TEXT_EXTENSIONS,
} from "./types.ts";
import type { Attachment, AttachError, AttachmentKind, Result } from "./types.ts";

export interface LoadOpts {
  homeDir?: string;
}

function err(code: AttachError["code"], message: string, path?: string): AttachError {
  return { code, message, path };
}

function expandHome(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/")) return resolve(homeDir, p.slice(2));
  return p;
}

function isUnderDir(file: string, dir: string): boolean {
  const rel = relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isDenied(absPath: string, homeDir: string): boolean {
  const base = basename(absPath);
  for (const prefix of DENY_BASENAME_PREFIXES) {
    if (base.startsWith(prefix)) return true;
  }
  for (const dir of DENY_LIST_DIRS) {
    const denied = resolve(homeDir, dir);
    if (isUnderDir(absPath, denied)) return true;
  }
  return false;
}

function sniffMime(buf: Buffer, ext: string): { mime: string; kind: AttachmentKind } | null {
  if (buf.length >= 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { mime: "image/png", kind: "image" };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { mime: "image/jpeg", kind: "image" };
    }
    if (
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) &&
      buf[5] === 0x61
    ) {
      return { mime: "image/gif", kind: "image" };
    }
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return { mime: "image/webp", kind: "image" };
    }
  }
  if (looksLikeText(buf) && TEXT_EXTENSIONS.has(ext)) {
    return { mime: mimeFromTextExt(ext), kind: "text" };
  }
  return null;
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8 * 1024));
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return false;
    if (b < 0x09) return false;
    if (b > 0x0d && b < 0x20 && b !== 0x1b) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function mimeFromTextExt(ext: string): string {
  switch (ext) {
    case ".json":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".toml":
      return "application/toml";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return "text/javascript";
    case ".py":
      return "text/x-python";
    case ".go":
      return "text/x-go";
    case ".rs":
      return "text/x-rust";
    case ".sh":
      return "text/x-shellscript";
    case ".log":
    case ".txt":
    default:
      return "text/plain";
  }
}

export async function loadAttachment(
  rawPath: string,
  opts: LoadOpts = {},
): Promise<Result<Attachment, AttachError>> {
  const homeDir = opts.homeDir ?? homedir();
  if (!rawPath || rawPath.trim().length === 0) {
    return { ok: false, error: err("not_found", "empty path") };
  }

  const expanded = expandHome(rawPath.trim(), homeDir);
  const absPath = isAbsolute(expanded) ? normalize(expanded) : resolve(process.cwd(), expanded);

  // Path traversal: any literal `..` segment after normalize means it tried to climb.
  const segments = absPath.split(sep);
  if (segments.includes("..")) {
    return { ok: false, error: err("path_traversal", "path contains traversal", absPath) };
  }

  if (isDenied(absPath, homeDir)) {
    return { ok: false, error: err("deny_listed", "path on deny-list", absPath) };
  }

  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(absPath);
  } catch {
    return { ok: false, error: err("not_found", "stat failed", absPath) };
  }

  if (st.isSymbolicLink()) {
    return { ok: false, error: err("symlink_rejected", "symlinks rejected", absPath) };
  }
  if (!st.isFile()) {
    return { ok: false, error: err("not_regular_file", "not a regular file", absPath) };
  }
  if (st.size === 0) {
    return { ok: false, error: err("empty_file", "file is empty", absPath) };
  }

  const ext = extname(absPath).toLowerCase();
  const probablyImage = IMAGE_EXTENSIONS.has(ext);
  const probablyText = TEXT_EXTENSIONS.has(ext);
  if (!probablyImage && !probablyText) {
    return { ok: false, error: err("ext_not_allowed", `extension ${ext || "<none>"} not allowed`, absPath) };
  }

  // Cap pre-read by extension hint, then re-verify after sniff.
  const preCap = probablyImage ? capForKind("image") : MAX_TEXT_BYTES;
  if (st.size > preCap) {
    return { ok: false, error: err("too_large", `${st.size}B > cap ${preCap}B`, absPath) };
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch {
    return { ok: false, error: err("read_failed", "read failed", absPath) };
  }

  const sniffed = sniffMime(buf, ext);
  if (!sniffed) {
    return { ok: false, error: err("mime_not_allowed", "mime sniff rejected", absPath) };
  }
  if (sniffed.kind === "image" && !IMAGE_MIMES.has(sniffed.mime)) {
    return { ok: false, error: err("mime_not_allowed", `image mime ${sniffed.mime} not allowed`, absPath) };
  }
  if (sniffed.kind === "text" && !isTextMime(sniffed.mime)) {
    return { ok: false, error: err("mime_not_allowed", `text mime ${sniffed.mime} not allowed`, absPath) };
  }

  const cap = capForKind(sniffed.kind);
  if (buf.length > cap) {
    return { ok: false, error: err("too_large", `${buf.length}B > cap ${cap}B`, absPath) };
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  return {
    ok: true,
    value: {
      kind: sniffed.kind,
      filename: basename(absPath),
      mime: sniffed.mime,
      sizeBytes: buf.length,
      sha256,
      payload: buf,
    },
  };
}

export function buildTextAttachmentBlock(att: Attachment): string {
  if (att.kind !== "text") return "";
  const lang = langFromMime(att.mime);
  const text = att.payload.toString("utf-8");
  const fence = "```";
  return `${fence}${lang} filename=${att.filename}\n${text}\n${fence}`;
}

export function buildImageDataUrl(att: Attachment): string {
  if (att.kind !== "image") return "";
  return `data:${att.mime};base64,${att.payload.toString("base64")}`;
}

function langFromMime(mime: string): string {
  if (mime === "application/json") return "json";
  if (mime === "application/yaml") return "yaml";
  if (mime === "application/toml") return "toml";
  if (mime === "text/markdown") return "md";
  if (mime === "text/csv") return "csv";
  if (mime === "text/javascript") return "ts";
  if (mime === "text/x-python") return "py";
  if (mime === "text/x-go") return "go";
  if (mime === "text/x-rust") return "rust";
  if (mime === "text/x-shellscript") return "sh";
  return "";
}

export function isImage(att: Attachment): boolean {
  return att.kind === "image" && isImageMime(att.mime);
}

export function shortSha(att: Attachment): string {
  return att.sha256.slice(0, 8);
}
