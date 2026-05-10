const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})([^`~\n\r]*)$/u;
const TAB_DISPLAY = "  ";

export interface AssistantDisplayLine {
  kind: "text" | "code";
  text: string;
  language?: string;
}

function isFenceClose(line: string, fenceChar: string, minLength: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < minLength) return false;
  for (const char of trimmed) {
    if (char !== fenceChar) return false;
  }
  return true;
}

function isMarkdownFence(info: string): boolean {
  const lang = info.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return lang === "markdown" || lang === "md" || lang === "mdown";
}

function fenceLanguage(info: string): string | undefined {
  const lang = info.trim().split(/\s+/u)[0]?.toLowerCase();
  return lang && !isMarkdownFence(lang) ? lang : undefined;
}

export function assistantDisplayLines(content: string): AssistantDisplayLine[] {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const output: AssistantDisplayLine[] = [];
  let fenceChar = "";
  let fenceLength = 0;
  let fenceKind: AssistantDisplayLine["kind"] = "text";
  let fenceLang: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/gu, TAB_DISPLAY);
    if (fenceChar.length > 0) {
      if (isFenceClose(line, fenceChar, fenceLength)) {
        fenceChar = "";
        fenceLength = 0;
        fenceKind = "text";
        fenceLang = undefined;
      } else {
        output.push({ kind: fenceKind, text: line, language: fenceLang });
      }
      continue;
    }

    const openingFence = FENCE_OPEN_RE.exec(line);
    if (openingFence) {
      const marker = openingFence[1]!;
      const info = openingFence[2] ?? "";
      fenceChar = marker[0]!;
      fenceLength = marker.length;
      fenceKind = isMarkdownFence(info) ? "text" : "code";
      fenceLang = fenceKind === "code" ? fenceLanguage(info) : undefined;
      continue;
    }

    output.push({ kind: "text", text: line });
  }

  return output;
}

export function normalizeAssistantDisplayContent(content: string): string {
  return assistantDisplayLines(content)
    .map((line) => line.text)
    .join("\n");
}

export function normalizeAssistantMarkdownRenderContent(content: string): string {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const output: string[] = [];
  let fenceChar = "";
  let fenceLength = 0;
  let markdownFence = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/gu, TAB_DISPLAY);
    if (fenceChar.length > 0) {
      if (isFenceClose(line, fenceChar, fenceLength)) {
        if (!markdownFence) output.push("```");
        fenceChar = "";
        fenceLength = 0;
        markdownFence = false;
      } else {
        output.push(line);
      }
      continue;
    }

    const openingFence = FENCE_OPEN_RE.exec(line);
    if (openingFence) {
      const marker = openingFence[1]!;
      const info = openingFence[2] ?? "";
      fenceChar = marker[0]!;
      fenceLength = marker.length;
      markdownFence = isMarkdownFence(info);
      if (!markdownFence) output.push("```");
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

export function firstDisplayLine(content: string): string {
  return content.split("\n").find((line) => line.trim().length > 0) ?? "";
}
