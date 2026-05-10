# SPEC - Drexler

## Goal

Drexler is a Bun + TypeScript terminal chat app. It provides an Ink-based interactive UI around a corporate-executive AI persona, talks to OpenRouter-compatible chat completion models, and keeps the local experience fast, polished, and terminal-native.

## Runtime Constraints

- Bun runtime, TypeScript source, React/Ink terminal UI.
- Terminal-only product: no web server, GUI, database, or browser client.
- Chat only: no model tool calls, no model-side filesystem access, no multimodal input.
- OpenRouter API key is required. Missing keys are collected on first run and stored locally.
- User transcript history is in memory for the current session. Config and explicit transcript exports are the only persistent writes.
- Config is plain JSON under `~/.config/drexler/config.json`, with legacy `~/.drexlerrc` read fallback.

## Interfaces

- Binary: `drexler`, entry `src/index.ts`.
- Flags:
  - `--model <31b|26b|vendor/name>`
  - `--persona <path>`
  - `--theme <name>`
  - `--no-intro`
  - `--fast`
  - `--version`, `-v`
  - `--help`, `-h`
- Environment:
  - `OPENROUTER_API_KEY`
  - `DREXLER_MODEL`
  - `DREXLER_THEME`
  - `DREXLER_NO_INTRO`
  - `DREXLER_FAST`
  - `XDG_CONFIG_HOME`
  - `NO_COLOR`
- Config keys:
  - `apiKey`
  - `model`
  - `maxHistory`
  - `personaPath`
  - `theme`
  - `noIntro`
  - `fast`
- Persona file: `prompts/drexler.md` by default.
- OpenRouter request: `POST https://openrouter.ai/api/v1/chat/completions` with streamed chat-completion response parsing.

## Models

- Alias `31b`: `google/gemma-4-31b-it`
- Alias `26b`: `google/gemma-4-26b-a4b-it`
- Full OpenRouter-style ids are accepted when they match `vendor/model` or `vendor/model:tag`.
- HTTP 429 from the primary model retries once against the fallback model.

## Themes

Available themes are `apollo`, `amber`, `mono`, `terminal`, `dealroom`, `midnight`, `paper`, and `plasma`.

- CLI flag `--theme` applies for the launch.
- `/theme <name>` switches the current session.
- `/theme <name> save` persists the choice.
- `/theme save` persists the currently active theme.
- `NO_COLOR` forces `mono`.

## Slash Commands

Slash commands are local directives. They are case-insensitive, never sent to the model, and never appended to conversation history.

| command | behavior |
| --- | --- |
| `/help` | print all directives |
| `/clear` | reset conversation history while preserving the system prompt |
| `/exit` | end the session |
| `/synergy` | run the animated synergy event in Ink, or print fallback text outside the live UI |
| `/model [id]` | show or switch model |
| `/theme [name] [save]` | show, switch, or persist theme |
| `/startup fast\|no-intro\|normal` | persist startup behavior |
| `/history` | show message count and approximate tokens |
| `/regenerate` | re-roll the latest response |
| `/redo` | alias for `/regenerate` |
| `/retry [terse\|brutal]` | re-roll with a style instruction |
| `/expand` | print the latest Drexler response |
| `/quote` | quote the latest Drexler response |
| `/search <term>` | search the in-memory transcript |
| `/export md\|txt\|json\|html [path]` | export the transcript |
| `/save [path]` | save transcript as markdown |
| `/save-last [path]` | save latest Drexler response as markdown |
| `/copy-last` | copy latest Drexler response to the OS clipboard |

The command palette opens for `/` input and provides argument choosers for `/theme`, `/startup`, `/retry`, `/export`, and `/model`.

## UI Behavior

- Interactive TTY launches use Ink. Non-TTY launches fall back to linear readline output.
- Normal interactive startup shows one mascot panel with the mascot, a fixed-height greeting slot, a Mood readout, tips, and an embedded Deal Desk box.
- Short terminals suppress oversized startup chrome to protect chat usability.
- The startup Mood readout must keep stable geometry during boot. Its gauge row contains only the fixed-width bar and percentage; phase copy belongs on the subtext row.
- When startup completes, Mood resolves to the current mood plus rotating satirical posture/detail copy. Repeated launches with the same mood may choose different posture/detail pairs.
- Wide startup layouts keep the Mood box aligned with the Deal Desk box. Greeting wrapping must not move the Mood box or add rows to the lower dashboard area.
- The embedded Deal Desk is satirical product chrome, not model telemetry. It shows mood-shaped boardroom status, memo count, mandate, risk, fees, and counsel/corporate copy.
- Transcript turns render as bordered cards aligned to the input width.
- User and Drexler cards use distinct accents but share consistent width and border geometry.
- Drexler response bodies use a diamond marker; user bodies use a chevron marker.
- Assistant display normalizes markdown/code fences so raw fence markers and language labels do not leak into the transcript. Non-markdown fenced code renders as code with Dracula-inspired syntax coloring.
- Save/export commands preserve the underlying conversation content instead of the UI-only normalized display.
- Long text, wide glyphs, spinner labels, status rows, command rows, and Deal Desk rows must be display-width bounded so they do not wrap unpredictably or clip the right edge.
- During model streaming or synergy animation, input is locked until the active operation finishes.

## Invariants

- System message is always index 0 and is never trimmed.
- When history exceeds `maxHistory` (default 50), trim oldest non-system messages.
- Missing API key prompts on first interactive run; cancel or invalid key exits nonzero.
- Config writes use atomic temp-file rename and mode `0600`.
- `--persona` must resolve to a regular `.md` file; symlinks and non-markdown paths are rejected.
- Unknown slash commands print an in-character local error and make no model call.
- Empty input prints a local nudge and makes no model call.
- Stream errors do not append partial assistant text to history.
- SIGINT closes active work and exits cleanly.
- ESC cancels an active model response without quitting. ESC does not cancel `/synergy`; the synergy event owns input until it completes.
- Startup greeting is selected from the persona's session openers.
- Markdown rendering supports styled terminal output without emitting raw HTML.
- Export and save commands reject traversal, enforce expected extensions, and refuse to overwrite existing files.

## Release

- `package.json` version and `v*` tag version must match.
- CI installs dependencies, verifies tag/package version match, typechecks, runs tests, and publishes to npm with provenance.
- Local release check: `bun run prepublishOnly`.
