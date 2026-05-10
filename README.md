# Drexler

[![npm version](https://img.shields.io/npm/v/drexler.svg)](https://www.npmjs.com/package/drexler)
[![license](https://img.shields.io/npm/l/drexler.svg)](./LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun%20%E2%89%A5%201.1-black)](https://bun.sh)

CLI chat with **Drexler**, a corporate-executive AI persona who speaks in broken third-person and treats every conversation like a hostile takeover. Built with Bun + TypeScript. Talks to OpenRouter's Gemma 4 31B model (paid).

> "Drexler usually charge consulting fee for this. Today, pro bono. You welcome."

---

## Quickstart

```bash
bun add -g drexler
drexler
```

That's it. First launch prompts for an OpenRouter API key (free at <https://openrouter.ai/keys>) and remembers it. Subsequent launches skip the prompt.

---

## Install

### 1. Install Bun (skip if already installed)

Bun ≥ 1.1 is required. Install once per machine:

| Platform        | Command                                                              |
| --------------- | -------------------------------------------------------------------- |
| **macOS/Linux** | `curl -fsSL https://bun.sh/install \| bash`                          |
| **Homebrew**    | `brew install oven-sh/bun/bun`                                       |
| **Windows**     | `powershell -c "irm bun.sh/install.ps1 \| iex"`                      |
| **npm**         | `npm install -g bun`                                                 |

Verify: `bun --version` → should print `1.1.0` or higher.

### 2. Install Drexler globally

```bash
bun add -g drexler
```

This installs the `drexler` command into `~/.bun/bin/drexler`. Make sure `~/.bun/bin` is on your `$PATH` (Bun's installer does this automatically; if not, add `export PATH="$HOME/.bun/bin:$PATH"` to your shell rc).

### 3. Run it

```bash
drexler
```

On first run you'll see:

```
Drexler notice no API key on file. Even CEO need credentials.
Get free key at: https://openrouter.ai/keys
Enter OpenRouter API key:
```

Paste the key, hit return. Drexler saves it to `~/.config/drexler/config.json` (mode `0600`) and boots into the chat. Done.

---

## Update

```bash
bun update -g drexler
```

## Uninstall

```bash
bun remove -g drexler
rm -rf ~/.config/drexler   # optional: wipe stored key + settings
```

---

## Usage

### Flags

| flag                              | what                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `--model <31b\|26b\|vendor/name>` | switch model (alias or full OpenRouter id, e.g. `google/gemma-4-31b-it`) |
| `--persona <path>`                | load a custom persona markdown file instead of bundled `drexler.md` |
| `--theme <name>`                  | color theme (default `apollo`)                                    |
| `--no-intro`                      | skip the startup banner and mascot                                |
| `--fast`                          | fast startup mode, implies `--no-intro`                           |
| `--version`, `-v`                 | print version                                                     |
| `--help`, `-h`                    | print usage                                                       |

### Slash commands (inside the REPL)

| cmd            | what it do                                       |
| -------------- | ------------------------------------------------ |
| `/help`        | list directives                                  |
| `/clear`       | shred conversation history (system prompt pinned) |
| `/exit`        | meeting adjourned                                |
| `/synergy`     | SYNERGY!                                         |
| `/model`       | show current model, or `/model 26b` to switch   |
| `/theme`       | show/switch theme; append `save` to persist, e.g. `/theme midnight save` |
| `/startup fast\|no-intro\|normal` | persist startup behavior for future launches |
| `/history`     | message count + approx tokens                    |
| `/regenerate`  | re-roll last response                            |
| `/retry terse\|brutal` | re-roll last response with a style mandate |
| `/expand`      | print Drexler's latest response                  |
| `/quote`       | quote Drexler's latest response                  |
| `/search <term>` | search the current transcript                 |
| `/export md\|txt\|json\|html [path]` | export transcript       |
| `/save [path]` | archive conversation as markdown                 |
| `/save-last [path]` | save Drexler's last response only          |
| `/copy-last`   | copy Drexler's latest response to the clipboard  |

`Ctrl+C` exits gracefully with an in-character farewell.

---

## Configuration

Drexler reads config in this priority (later wins):

1. `~/.config/drexler/config.json` — written on first run
2. Environment variables
3. CLI flags

### Environment variables

| var                  | purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `OPENROUTER_API_KEY` | API key (overrides config file)                      |
| `DREXLER_MODEL`      | model id or alias                                    |
| `DREXLER_THEME`      | color theme name                                     |
| `DREXLER_NO_INTRO`   | `1`, `true`, `yes`, or `on` skips startup intro      |
| `DREXLER_FAST`       | `1`, `true`, `yes`, or `on` enables fast startup     |
| `XDG_CONFIG_HOME`    | override config dir (default `~/.config/drexler`)    |
| `NO_COLOR`           | disable colors entirely                              |

### Config file

`~/.config/drexler/config.json`:

```json
{
  "apiKey": "sk-or-v1-...",
  "model": "google/gemma-4-31b-it",
  "maxHistory": 50,
  "personaPath": "/optional/path/to/custom-persona.md",
  "theme": "apollo",
  "noIntro": false,
  "fast": false
}
```

Default `maxHistory`: 50 messages.

Available launch/config themes: `apollo`, `amber`, `mono`, `terminal`, `dealroom`, `midnight`, `paper`, and `plasma`.
`NO_COLOR` always forces `mono`.

---

## Models

| alias  | id                                  | notes                          |
| ------ | ----------------------------------- | ------------------------------ |
| `31b`  | `google/gemma-4-31b-it`             | primary (paid)                 |
| `26b`  | `google/gemma-4-26b-a4b-it`         | fallback, auto-retry on 429    |

Pass `--model vendor/name:tag` for any other OpenRouter-compatible model.

---

## From source (development)

```bash
git clone https://github.com/showOS/Drexler.git
cd Drexler
bun install
cp .env.example .env       # then edit, paste key into OPENROUTER_API_KEY=
bun run start
```

### Tests + typecheck

```bash
bun test
bun run typecheck
```

### Releasing a new version

```bash
npm version <patch|minor>  # bumps package.json, commits, tags
git push --follow-tags     # CI publishes to npm automatically
```

The `.github/workflows/publish.yml` workflow runs typecheck + tests + `npm publish --provenance` on every `v*` tag push.

---

## Troubleshooting

| symptom                                                    | fix                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `command not found: drexler`                               | Add `~/.bun/bin` to `$PATH`, or restart shell                                             |
| `command not found: bun`                                   | Install Bun (see [Install](#install) section above)                                       |
| `API key rejected by OpenRouter`                           | Update key: `rm ~/.config/drexler/config.json` and re-run `drexler`, or export `OPENROUTER_API_KEY` |
| Garbled box-drawing characters                             | Use a UTF-8 terminal with a Nerd Font (e.g. iTerm2, Alacritty, WezTerm)                   |
| Want to switch themes mid-session                          | Use `/theme midnight`, `/theme dealroom`, `/theme amber`, or any listed theme inside the REPL |
| Want a faster launch                                       | Use `drexler --fast` or set `"fast": true` in config                                     |

---

## License

MIT — see [LICENSE](./LICENSE).
