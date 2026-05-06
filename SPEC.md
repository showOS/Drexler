# SPEC — Drexler

## §G Goal

CLI chat REPL. Bun+TS. OpenRouter free-tier Gemma 4. Drexler corporate-exec persona. In-memory history. Streamed output. No tool use.

## §C Constraints

- C1: Bun runtime, TypeScript src.
- C2: OpenRouter free tier only. No paid models.
- C3: No persistent storage. History in-memory per session.
- C4: Chat only. No tool/function calling, no fs writes by LLM, no multimodal.
- C5: Terminal-only UI. No web, no GUI.
- C6: No external DB. Config file is plain JSON.

## §I Interfaces

- I.bin: `drexler` (entry `src/index.ts`).
- I.flags: `--model <31b|26b|id>`, `--persona <path>`.
- I.env: `OPENROUTER_API_KEY` (required), `DREXLER_MODEL` (optional override).
- I.config: `~/.config/drexler/config.json` (fallback `~/.drexlerrc`). Keys: `model`, `max_history`, `persona_path`, `api_key`.
- I.files: `prompts/drexler.md` (default persona). `.env` / `.env.example`.
- I.openrouter: `POST https://openrouter.ai/api/v1/chat/completions`. OpenAI-compat body `{model, messages, stream:true}`. SSE response.
- I.models: primary `google/gemma-4-31b-it`, fallback `google/gemma-4-26b-a4b-it`. Aliases `31b`/`26b`.
- I.cmds: `/help` `/clear` `/exit` `/synergy` `/model` `/history`. Case-insensitive.
- I.prompt: bordered Apollo green box with `❯` chevron prompt label (Ink TUI in TTY mode); plain `❯ ` styled prompt in non-TTY readline fallback.
- I.exit: code 0 normal; nonzero on fatal (missing persona, user-cancel first-run, bad flag).

## §V Invariants

- V1: System message always index 0 of messages array. Never trimmed.
- V2: When history > `max_history` (default 50), trim oldest non-system. System pinned.
- V3: HTTP 429 from primary model → one retry on fallback model, same body except `model`. No infinite loop.
- V4: SIGINT prints in-character exit line, closes any open stream, exits 0.
- V5: Missing API key → first-run prompt. User cancel → exit nonzero. Provided key → write to config file.
- V6: Persona file missing/unreadable → fatal, nonzero exit, error names path.
- V7: Slash commands dispatched locally. Never sent to LLM. Never appended to history.
- V8: Unknown slash command → in-character "not recognize" line. No LLM call.
- V9: Empty input → in-character nudge. No LLM call. No history append.
- V10: Stream error mid-response → in-character error line. Partial assistant text NOT appended to history (history stays consistent).
- V11: `--persona` overrides default path. File must exist at startup or fatal.
- V12: `--model` value must resolve to alias or known id. Unknown → fatal.
- V13: Startup shows exactly one random greeting drawn from persona's Session Openers list.
- V14: Markdown render: bold, inline code, fenced code with syntax highlight. No raw HTML emitted.
- V15: User input echoed before assistant reply; assistant tokens flushed as they stream.
- V16: `/clear` resets history but preserves system message and `max_history`.
- V17: `/model` switch updates active model for subsequent calls; in-flight stream unaffected.

## §T Tasks

| id  | status | desc                                                                                  | cites               |
| --- | ------ | ------------------------------------------------------------------------------------- | ------------------- |
| T1  | x      | init bun project: package.json, tsconfig.json, bunfig.toml, .gitignore                | C1                  |
| T2  | x      | src/types.ts: Message, Role, Config, ModelId types                                    | C1                  |
| T3  | x      | src/config.ts: load env + config file, parse --model/--persona flags, first-run setup | I.env,I.config,V5,V11,V12 |
| T4  | x      | src/persona.ts: read persona md, extract system prompt + greetings list               | I.files,V6,V13      |
| T5  | x      | src/conversation.ts: history mgr, system-pinned trim at max_history                   | V1,V2,V16           |
| T6  | x      | src/llm.ts: OpenRouter client, SSE parse, stream tokens, 429 fallback retry           | I.openrouter,V3,V10 |
| T7  | x      | src/renderer.ts: styled prompt, markdown + syntax highlight, banner ASCII art         | V14,V15             |
| T8  | x      | src/commands.ts: slash router for /help /clear /exit /synergy /model /history         | I.cmds,V7,V8,V16,V17 |
| T9  | x      | src/repl.ts: REPL loop, multi-line input, Ctrl+C, empty-input nudge                   | V4,V9,V15           |
| T10 | x      | src/index.ts: entry — banner, random greeting, wire config+persona+repl              | V5,V13              |
| T11 | x      | prompts/drexler.md: place persona file at runtime path                                | I.files             |
| T12 | x      | .env.example, README with setup steps                                                 | I.env               |
| T13 | x      | smoke test: dry-run REPL with mock OpenRouter, assert history invariants              | V1,V2,V7,V10        |

## §B Bugs

| id  | date | cause | fix |
| --- | ---- | ----- | --- |
