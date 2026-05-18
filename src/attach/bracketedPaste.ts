// §V74 — Explicit bracketed-paste mode toggle.
//
// Bracketed paste mode wraps pasted input in ESC[200~ ... ESC[201~ so
// the program can distinguish paste payloads from typed input. Most
// modern terminals enable it on demand but not by default; opting in
// guarantees `splitBracketedPaste` (src/attach/intake.ts) can detect
// paste payloads reliably.
//
// Best-effort: write failures swallowed, non-TTY skipped entirely so
// non-interactive runs (§V23) stay clean.

const ENABLE_SEQUENCE = "\x1b[?2004h";
const DISABLE_SEQUENCE = "\x1b[?2004l";

function writeBest(seq: string): void {
  try {
    const stream = process.stdout;
    if (!stream.isTTY) return;
    stream.write(seq);
  } catch {
    // best-effort: terminal closed / unwritable; ignore
  }
}

export function enableBracketedPaste(): void {
  writeBest(ENABLE_SEQUENCE);
}

export function disableBracketedPaste(): void {
  writeBest(DISABLE_SEQUENCE);
}

// Wire process termination signals to always disable bracketed paste
// before exit so the parent shell isn't left with stuck mode.
let signalHandlersInstalled = false;
let signalDisposer: (() => void) | null = null;

export function installBracketedPasteSignalHandlers(): () => void {
  if (signalHandlersInstalled) {
    return signalDisposer ?? (() => {});
  }
  signalHandlersInstalled = true;
  const handler = () => {
    disableBracketedPaste();
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  process.on("exit", handler);
  signalDisposer = () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
    process.off("exit", handler);
    signalHandlersInstalled = false;
    signalDisposer = null;
  };
  return signalDisposer;
}
