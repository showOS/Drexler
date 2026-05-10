# Changelog

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
