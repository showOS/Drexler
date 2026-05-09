# Drexler

CLI chat with **Drexler**, a corporate-executive AI persona who speaks in broken third-person and treats every conversation like a hostile takeover. Built with Bun + TypeScript. Talks to OpenRouter's Gemma 4 31B model (paid).

> "Drexler usually charge consulting fee for this. Today, pro bono. You welcome."

## Install

Requires [Bun](https://bun.sh) ≥ 1.1. One command:

```bash
bun add -g drexler
```

Then anywhere:

```bash
drexler
```

First launch prompts for an OpenRouter API key (free at <https://openrouter.ai/keys>) and saves it to `~/.config/drexler/config.json`. No further setup.

### Update

```bash
bun update -g drexler
```

### Uninstall

```bash
bun remove -g drexler
rm -rf ~/.config/drexler   # optional: wipe stored key + settings
```

## From source (dev)

```bash
git clone https://github.com/showOS/Drexler.git && cd Drexler
bun install
bun run start
```

Optional: `cp .env.example .env` and paste the key into `OPENROUTER_API_KEY=...` to skip the first-run prompt.

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
