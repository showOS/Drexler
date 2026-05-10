# Changelog

## Unreleased

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
