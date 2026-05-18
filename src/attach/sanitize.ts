// §V73 — Export/save sanitizer.
//
// Strips fenced text-attachment blocks from synthesized user-message
// text and substitutes `[attachment: <name> (<size>) sha256:<8>]`
// placeholders. Image attachments already arrive in the user message
// as that exact placeholder form (App.tsx onSubmit), so this sanitizer
// is a no-op for them.

const ATTACHMENT_FENCE_RE =
  /```[^\n`]*\bfilename=([^\s`]+)\s+size=(\d+)\s+sha256=([0-9a-f]{4,16})[^\n]*\n[\s\S]*?\n```/g;

function formatBytesShort(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function sanitizeAttachmentBlocks(text: string): string {
  return text.replace(ATTACHMENT_FENCE_RE, (_match, filename, sizeStr, sha) => {
    const size = Number.parseInt(sizeStr, 10);
    const sizeText = Number.isFinite(size) ? formatBytesShort(size) : `${sizeStr}B`;
    return `[attachment: ${filename} (${sizeText}) sha256:${sha}]`;
  });
}
