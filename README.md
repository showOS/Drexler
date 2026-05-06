# Drexler

CLI chat with **Drexler**, a corporate-executive AI persona who speaks in broken third-person and treats every conversation like a hostile takeover. Built with Bun + TypeScript. Talks to OpenRouter's Gemma 4 31B model (paid).

> "Drexler usually charge consulting fee for this. Today, pro bono. You welcome."

## Install

```bash
bun install
```

## Setup

Get a free OpenRouter API key at <https://openrouter.ai/keys>.

Either:

```bash
cp .env.example .env
# edit .env, paste your key
```

Or run Drexler — first launch will prompt for a key and save it to `~/.config/drexler/config.json`.

## Run

```bash
bun run start
# or
bun run src/index.ts
```

## Flags

- `--model <31b|26b|vendor/name:tag>` — switch model (alias or full OpenRouter id).
- `--persona <path>` — load a custom persona markdown file instead of `prompts/drexler.md`.

## Slash commands

| cmd        | what it do                                  |
| ---------- | ------------------------------------------- |
| `/help`    | list directives                             |
| `/clear`   | shred conversation history (system pinned)  |
| `/exit`    | meeting adjourned                           |
| `/synergy` | SYNERGY!                                    |
| `/model`   | show current model, or `/model 26b` to switch |
| `/history` | message count + approx tokens               |

`Ctrl+C` exits gracefully with an in-character farewell.

## Configuration

- Env: `OPENROUTER_API_KEY`, `DREXLER_MODEL` (optional override).
- Config file: `~/.config/drexler/config.json` — keys: `apiKey`, `model`, `maxHistory`, `personaPath`.
- Default `maxHistory`: 50.

## Models

- Primary: `google/gemma-4-31b-it` (paid)
- Fallback: `google/gemma-4-26b-a4b-it` (paid, auto-retry on 429)

## Test

```bash
bun test
bun run typecheck
```

## License

MIT.
