# Changelog

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
