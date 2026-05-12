# Changelog

## 0.2.29

- **Pet decay now suspend-aware**: closing the laptop no longer dodges hours of pet decay. The 60s tick switched from a fixed 1-minute subtraction to the existing elapsed-aware `applyDecay`, and `updatePetStats` stamps `lastSaved` on the in-memory copy so subsequent ticks measure from the right anchor.

## 0.2.28

- **Conversation autosave + `--resume`**: every assistant turn writes the transcript to `~/.local/state/drexler/last-session.json` (atomic temp + rename, schema-versioned, 200-message ring). Launch with `--resume` to rehydrate the prior session into the freshly-built conversation.
- **Per-message actions**: `/history` now prints a numbered transcript with snippets. `/expand [n]`, `/quote [n]`, `/copy [n]` accept the 1-based index; bare forms still fall back to the last assistant turn. `/copy-last` stays as an alias.
- **`/edit [n]`**: pulls a prior user message back into the input box for editing. Powered by a new `CommandAction { type: "draft"; value }`.
- **In-session re-key via `/auth`**: 401/403 now surfaces a "Run /auth" prompt instead of forcing a restart. `/auth <key>` validates, replaces the in-session API key, and persists to the config — the next request uses the new key without restarting.

## 0.2.26

- **Reliability**: connect timeout (10s) on every LLM fetch — composed with the user abort signal so Esc still cancels mid-handshake. Idle-stream timeout (30s) bails cleanly when a hung SSE connection stops emitting chunks. Exponential backoff on 5xx with ±25% jitter, up to 3 attempts. 429 second-shot retry on the primary model after both primary + fallback rate-limit.
- **Streaming latency**: SSE JSON fast-path slices `delta.content` between quotes for the common chunk shape, falling back to JSON.parse on any escape or alternate shape. ~3-5× cheaper per token chunk.
- **Render latency**: `splitGraphemes` + `displayWidth` short-circuit for pure-ASCII input, skipping `Intl.Segmenter` entirely. Dominant cost for English-heavy renders across transcript, markdown, status, and input rendering.
- **Multi-line input**: Shift+Enter (Kitty / iTerm2 / Windows Terminal) and Alt+Enter (universal) insert a literal newline at the cursor instead of submitting. Paste preserves CRLF/LF so multi-line content survives. Plain Enter still submits.
- **Live token count**: surfaced in the status bar as `~N tok` (or `~N.Nk tok` above 1k). Hidden in compact mode.
- **Early-abort rollback**: pressing Esc before the first assistant token arrives now pops the just-pushed user turn from both the conversation and the transcript so dead user turns no longer accumulate on repeated quick aborts.

## 0.2.24

- Streaming pipeline: first token bypasses the 33ms throttle for noticeably snappier first-byte latency. The token buffer is now an array joined on flush instead of string concatenation, so long responses stop churning V8 ropes.
- Render pass: `Spinner`, `StreamingMessage` content normalizers, and `computeMascotLayout` are memo'd so unrelated re-renders don't re-derive them. `renderDealDeskHeader` is a stable `useCallback` so `MascotDashboard.dealDesk` stays referentially identical.
- Filtering: `filterArgumentPalette` is now a single-pass filter, halving the per-keystroke `toLowerCase` work for `/theme`, `/model`, `/startup`, `/retry`, `/export`. `/search` precomputes the term lowercase once.
- Width math: `fitDisplayText` rewritten from an O(n²) `displayWidth`-in-loop to a single-pass O(n) accumulator. Hot path for every transcript / markdown / status / palette / pet-panel render.
- Config caching: `loadConfigFile` is read once and cached for the process lifetime instead of three+ times per startup. `saveConfig` invalidates the cache so writes remain visible.
- Pet office scene reworked into a structured sprite/timeline pipeline with `composeScene` driving named sprites with z-indexes and visibility predicates.

## 0.2.23

- Redesigned the office pet scene from the ground up against ANSI/TUI art best practices: focal hierarchy, rule-of-thirds composition, single border vocabulary, four-stop brightness ladder, density-gradient backgrounds.
- One dominant boardroom window now frames an animated city skyline made from half-block silhouettes (`▆▇█`) with lit-window flicker (`█▒` / `█░`) on a per-tower rotating phase.
- Sky band carries one sun/moon glyph and a slowly drifting cloud. Window top frame shows an in-fiction clock (advances one minute every 5 frames). Window bottom frame restates the activity line plus a single DL% readout — no chrome echo.
- Mascot is centered with only two desk props: `▭ DREX` nameplate (cursor blinks while working, switches to `▭ zzz` while sleeping) and the steaming `╭c~╮` mug.
- Single horizon rule replaces the bordered desk strip + floor dots. Steam wisp lives on the horizon row.
- Activity accents (`z z Z`, `* *`, `$ $`, `~ ~`, `[$]`) live in the empty cells flanking the mascot.
- Multiple subtle animation channels (skyline flicker, cloud drift, clock, brow/eye/lock, cursor blink, steam wisp, memo rotation) cap at ~3 fps so the scene reads alive without feeling jittery.

## 0.2.16

- Added an interactive pet system: feed, play, work, praise, rest, vibe, name, and profile commands; persistent stats with offline decay; intern→analyst→associate→VP→MD rank ladder driven by lifetime deal accumulation; 90-second cooldowns per action with in-character rejection copy.
- Adaptive pet UI: full animated panel on wide terminals (cols ≥ 112), bordered compact panel on medium terminals (≥ 48), one-line ticker surfacing the worst stat on tiny terminals.
- Compact panel routes stats through the existing satirical level ladder (peak/good/ok/low/critical) instead of bare percentages so it matches the Deal Desk surface.
- Pet save is now atomic (temp file + rename); dead-pet command guard prevents stat mutation during the death exit timer; frame interval pauses when the pet has died.
- Hardened launch flow: validate CLI flags and config before the first-run API key prompt with reason-specific errors. Fatal handlers moved off the interactive path so Ink's signal-exit can restore the terminal cleanly.
- Markdown link parser now balances parentheses, so URLs like `https://en.wikipedia.org/wiki/Foo_(bar)` parse correctly.
- New informational commands: `/setup` prints config + API key source without leaking the key; `/update` prints upgrade instructions and refuses to run installs.
- Transcript viewport enforces a hard row budget — oversized cards clip with an explicit `... N lines truncated — PageUp scrollback to read` hint; indicators report row counts in addition to item counts; scrollback keys work while a response is streaming.
- Command palette Enter on bare argument-parent commands (`/theme`, `/model`, `/startup`, `/retry`, `/export`) now reopens the chooser instead of executing the base form; history navigation preserves the unsent draft.
- Performance: collapsed duplicate width memos, hoisted divider/carpet constants, memoized StatBar, tightened the pet panel frame loop.

## 0.2.14

- Added a startup Mood panel with a stable boot gauge, percentage-only loading row, and rotating mood-specific posture/detail copy.
- Anchored the wide startup dashboard so wrapped greeting copy no longer pushes the Mood and Deal Desk boxes down or adds stray rows.
- Reworked the embedded Deal Desk into satirical mood-shaped product chrome instead of model/context telemetry.
- Improved Drexler transcript rendering with complete bordered cards, a diamond response marker, cleaned markdown/code fence display, and Dracula-inspired code syntax colors.
- Updated documentation to match current startup chrome, command palette behavior, keyboard controls, source setup, and layout invariants.

## 0.2.13

- Hardened startup panel layout across narrow, standard, and wide terminals.
- Clamped the embedded Deal Desk to its actual startup-panel column.
- Improved display-width clipping for Deal Desk, command palette, spinner, status bar, and transcript row budgeting.
- Added regression coverage for duplicate startup chrome, wide glyphs, long command rows, and short-terminal startup suppression.

## 0.2.12

- Removed the duplicate startup card render so normal launches show one startup panel.
- Tightened the embedded Deal Desk width so its box stays clean inside the startup panel.

## 0.2.11

- Moved the live Deal Desk chrome into the startup panel on normal launches.
- Kept a standalone Deal Desk header for fast and no-intro launches.
- Added coverage for embedded startup-panel Deal Desk rendering.

## 0.2.10

- Closed transcript turn blocks with right-side borders and corners so user and Drexler cards align with the input frame.
- Aligned the status row with the main chat chrome.

## 0.2.9

- Removed transcript card side labels like `incoming memo` and `response ledger`.
- Made each transcript card use a consistent top and bottom border color.

## 0.2.8

- Improved transcript readability by wrapping long user and Drexler message lines instead of truncating them.
- Kept wrapped continuation rows visually aligned inside the existing turn blocks.

## 0.2.7

- Stabilized `/synergy` animation layout with fixed row budgeting, a capped centered event panel, and completion only at 100%.
- Hardened interactive busy-state handling so input stays locked during active LLM requests and synergy events.
- Added lifecycle and row-budget coverage for the animated synergy flow.

## 0.2.6

- Upgraded `/synergy` into a rotating animated Ink event with staged reveals, progress, KPI tickers, and themed finale copy.
- Added compact synergy rendering and a non-interactive fallback line for classic command dispatch.

## 0.2.5

- Made constrained slash commands open smoother option choosers, with `/theme` showing all theme choices as soon as the command is typed.
- Added richer theme descriptions and contextual hints in the command palette.

## 0.2.4

- Improved transcript readability with distinct user and Drexler turn blocks, role-specific accents, and clearer body markers.

## 0.2.3

- Restored full-terminal-width interactive chrome, including the chat input bar.

## 0.2.2

- Added argument suggestions in the slash command palette for `/theme`, `/startup`, `/retry`, `/export`, and `/model`.
- Kept argument suggestion rows concise by avoiding duplicated hint copy.

## 0.2.1

- Fixed slash command help and palette coverage so every implemented command is discoverable.
- Kept overlapping slash-command previews visible, such as `/save` with `/save-last` and `/re` with `/regenerate`, `/redo`, and `/retry`.

## 0.2.0

- Added premium Ink chat chrome with responsive header, transcript viewport, command palette, input, live spinner, and streaming response states.
- Added expanded theme pack: `terminal`, `dealroom`, `midnight`, `paper`, and `plasma`.
- Added persisted UI preferences through `/theme <name> save`, `/theme save`, and `/startup fast|no-intro|normal`.
- Added transcript search, markdown/text/json/html export, save-last, copy-last, expand, quote, and styled retry commands.
- Added first-run Ink setup prompt with masked API key entry and inline validation.
- Added fast startup controls via `--fast`, `--no-intro`, `DREXLER_FAST`, and `DREXLER_NO_INTRO`.
- Improved narrow-terminal handling, scrollback, grapheme-aware input editing, and live response clipping.
- Expanded tests across commands, UI components, App state helpers, themes, config, and release smoke paths.
