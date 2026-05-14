# SPEC — Drexler

## §G Goal

Bun + TypeScript terminal chat app. Ink UI. Corporate-executive AI persona over OpenRouter chat-completion models. Terminal-native, fast, polished. Pet-mode dashboard layered on chat.

## §C Constraints

- Runtime: Bun ≥ 1.1, TypeScript source, React 19 + Ink 7 terminal UI.
- Terminal-only: no web server, GUI, DB, browser client.
- Chat only: no model tool calls, no model-side fs, no multimodal.
- OpenRouter API key required. Missing key collected first run, stored local.
- Transcript: in-memory current session. Persistent writes = config + explicit export.
- Config: JSON at `~/.config/drexler/config.json`. Legacy fallback `~/.drexlerrc` (read only).
- Pet state: JSON at `~/.drexler/pet.json`. Atomic temp+rename write.
- Deps lock: chalk ^5, cli-highlight ^2, ink ^7, marked ^18, marked-terminal ^7, react ^19.

## §I Interfaces

### Binary

- `drexler` → `src/index.ts`

### CLI flags

- `--model <31b|26b|vendor/name>`
- `--persona <path>` (`.md` regular file only)
- `--theme <name>`
- `--no-intro`
- `--fast` (implies `--no-intro`)
- `--version`, `-v`
- `--help`, `-h`

### Env vars

- `OPENROUTER_API_KEY`
- `DREXLER_MODEL`
- `DREXLER_THEME`
- `DREXLER_NO_INTRO` (`1|true|yes|on`)
- `DREXLER_FAST` (`1|true|yes|on`)
- `XDG_CONFIG_HOME`
- `NO_COLOR` (forces `mono`)

### Config keys

`apiKey`, `model`, `maxHistory` (default 50), `personaPath`, `theme`, `noIntro`, `fast`.

### Persona

- Default file: `prompts/drexler.md`
- `--persona`: only regular `.md` (reject symlinks, non-md).

### OpenRouter HTTP

- `POST https://openrouter.ai/api/v1/chat/completions`
- Streamed SSE parse → `streamChat()` in `src/llm.ts`.

### Models

- alias `31b` → `google/gemma-4-31b-it`
- alias `26b` → `google/gemma-4-26b-a4b-it`
- Full ids match `vendor/model` or `vendor/model:tag`.
- HTTP 429 primary → retry once against fallback.

### Themes

`apollo`, `amber`, `mono`, `terminal`, `dealroom`, `midnight`, `paper`, `plasma`.

- `--theme` launch override.
- `/theme <name>` session switch.
- `/theme <name> save` persist. `/theme save` persist current.
- `NO_COLOR` ⇒ `mono` forced.

### Slash commands

Case-insensitive. Local-only. Never sent to model. Never appended to history.

| cmd | behavior |
|---|---|
| `/help` | print directives |
| `/clear` | reset history, keep system prompt |
| `/exit` | end session |
| `/synergy` | Ink animated synergy event; non-TTY ⇒ fallback text |
| `/model [id]` | show or switch model |
| `/theme [name] [save]` | show / switch / persist theme |
| `/startup fast\|no-intro\|normal` | persist startup behavior |
| `/history` | message count + approx tokens |
| `/regenerate`, `/redo` | re-roll latest |
| `/retry [terse\|brutal]` | re-roll with style mandate |
| `/expand` | print latest Drexler response |
| `/quote` | quote latest Drexler response |
| `/search <term>` | transcript search |
| `/export md\|txt\|json\|html [path]` | export transcript |
| `/save [path]` | transcript ⇒ markdown |
| `/save-last [path]` | latest response ⇒ markdown |
| `/copy-last` | latest response ⇒ OS clipboard |
| `/pet [on\|off]` | toggle pet dashboard mode |
| `/feed` | pet: feed |
| `/play` | pet: play |
| `/work` | pet: work |
| `/praise` | pet: praise |
| `/rest` | pet: rest |
| `/vibe` | pet: choose own adventure |
| `/name [name]` | view or set pet name |
| `/profile` | print pet personnel file |
| `/debug` | dump last 5 telemetry frames (per V39) |
| `/respond <1\|2\|3>` | answer active event (V41,V42) |
| `/deals` | list active deals (V43) |
| `/trade <ticker> <buy\|sell>` | RTH market mini-game (V44) |
| `/buy <coffee\|pastry\|charter>` | spend deals for inventory item (V48) |
| `/use <coffee\|pastry\|charter>` | consume inventory item (V48) |
| `/graveyard` | list past pet lives (V47) |
| `/review` | re-show today's daily review (V49) |

Palette opens on `/`. Argument choosers: `/theme`, `/startup`, `/retry`, `/export`, `/model`, `/respond`, `/trade`, `/buy`, `/use`.

### Pet state — `src/pet/petState.ts`

- File: `~/.drexler/pet.json` (atomic temp+rename, swallow errors).
- Stats: `hunger`, `happiness`, `energy`, `deals` ∈ [0,100]. Plus `lastSaved`, `dead?`, `name?`, `createdAt?`, `lastActionAt?`, `lifetimeDeals?`, `activeDeals?`, `actionHistory?`, `inventory?`, `tradeSession?`, `lastReviewAt?`.
- Decay per hour: hunger 15, happiness 8, energy 10, deals 5. Applied over `now − lastSaved`.
- Cooldown per action: `PET_COOLDOWN_MS = 90_000` ms.
- Action reducers: `applyFeed`, `applyPlay`, `applyWork`, `applyPraise`, `applyRest`, `applyVibe`.
- `applyVibe` precedence: energy<30 ⇒ nap; else hunger<30 ⇒ feed; else 4 random branches via injectable `roll`.
- Death: any of hunger/happiness/energy ≤ 0. Next load resets to halfway (50/50/50/25).
- Rank thresholds (lifetime deals): intern 0, analyst 200, associate 400, vp 600, md 800.
- Rank increments per action: feed 2, play 1, work 8, vibe 3. `rest`/`praise` no rank gain.
- Name: NFKC normalize, strip `\p{Cf}`, allow `\p{L}\p{N} ._'-`, collapse ws, trim, slice 16.

### Event system — `src/pet/events.ts`

- Encounter pool: timed pop-ups in pet HUD. Types: pitch, takeover, coffee_machine, audit, mentor, comp_committee.
- Each event = `{id, kind, choices: [{key, label, stat_delta}], expiresAt}`. Choices 2–3.
- Spawn cadence: random in [6m, 18m]. Pet mode on, no active event, not busy streaming.
- Response: `/respond 1|2|3` or matching hotkey. 30s window. Late = auto-expire neutral.
- Outcome applies stat delta (±30 max), narrated via system addItem.

### Active Deals — `src/pet/deals.ts`

- Quest objects persisted in `pet.json.activeDeals[]`. Concurrent cap 2.
- Shape: `{id, name, requirements: [{action, count}], deadline, started, progress, reward}`.
- Spawn on `/work` w/ probability when no slot full; or via certain event outcomes.
- Tick checks deadline + requirements at every decay cycle and after each action.
- Completion = `lifetimeDeals += reward`. Failure = `happiness -= 10`, removed.

### Market trade — `src/pet/trade.ts`

- `/trade <AAPL|MSFT|NVDA> <buy|sell>` once per RTH session (09:30–16:00 local).
- Hidden 4-bit seed rotates per session; resolution = `(seed ^ tickerCode ^ sideBit) & 1`.
- Win: `+15 deals, +10 happiness, +5 lifetimeDeals`. Loss: `-15 deals, -5 happiness`.
- Off-hours = in-character reject ("after hours, partner").
- Stored in `pet.json.tradeSession: {date, seed, used}`.

### Synergy combos — `src/pet/synergy.ts`

- Ring buffer `actionHistory: [{action, at}]` length 4, append on every action.
- Recognized patterns within 5m window:
  - `work→play→praise` = +15 happiness, +15 energy, +10 deals.
  - `feed→work→work` = +20 deals.
  - `rest→work→praise` = +10 lifetimeDeals.
- Detection on every action commit. Consumed entries cleared so same prefix doesn't double-fire.

### Persona injection — `src/llm.ts` / `src/conversation/system.ts`

- When pet mode on, append pet status string to system prompt content (not new message).
- Format: `\n\nPET STATUS: name=<n> mood=<mood> hunger=<n>% happy=<n>% energy=<n>% rank=<rank>`. Cap 200 chars.
- Updated per model call; Drexler persona told to acknowledge mood subtly.

### Graveyard — `src/pet/graveyard.ts`

- File: `~/.drexler/graveyard.json`. Array of `{name, rank, tenure, cause, diedAt}`.
- Capped 50, FIFO trim. Atomic temp+rename.
- Written on death transition before respawn reset. Respawn halves `lifetimeDeals` (not zero).
- `/graveyard` slash prints last 10 entries in transcript card.

### Inventory — `src/pet/inventory.ts`

- `pet.json.inventory: {coffee, pastry, charter}` ∈ ℤ≥0.
- Cost (decremented from volatile `deals`): coffee 20, pastry 15, charter 30.
- Effects on `/use`:
  - coffee → `energy += 30` (clamp), bypass `rest` cooldown.
  - pastry → `hunger += 30`, clears `feed` cooldown.
  - charter → grants a second `/trade` this session.

### Daily review — `src/pet/review.ts`

- Anchored to local-calendar day via `lastReviewAt`.
- On launch (or `/pet on`), if no review today AND prior 24h has ≥1 action → render summary card.
- Card contents: yesterday deals closed, events survived, mood arc (delta), Drexler one-liner.
- `/review` re-prints today's card.

## §V Invariants

- V1 — System message always index 0. Never trimmed.
- V2 — History over `maxHistory` (default 50) trims oldest non-system.
- V3 — First interactive run with missing API key prompts. Cancel or invalid ⇒ exit nonzero.
- V4 — Config writes atomic temp+rename, mode `0600`.
- V5 — `--persona` resolves to regular `.md`. Symlinks + non-md rejected.
- V6 — Unknown slash prints in-character local error. No model call.
- V7 — Empty input prints local nudge. No model call.
- V8 — Stream error ⇒ no partial assistant text appended to history. User-visible "stream interrupted" notice surfaced in REPL + Ink UI. `/retry` re-rolls failed turn.
- V9 — SIGINT closes active work, exits clean.
- V10 — ESC cancels active model response without quitting. `/synergy` owns input until done; ESC does not cancel it.
- V11 — Startup greeting selected from persona session openers.
- V12 — Markdown render: styled terminal output, never raw HTML.
- V13 — Export/save: reject traversal, enforce extension, refuse overwrite.
- V14 — `package.json` version == `v*` tag version (CI gate).
- V15 — Mood gauge row: fixed-width bar + percentage only. Phase copy on subtext row.
- V16 — Wide startup: Mood box width-aligned with Deal Desk box. Greeting wrap does not move Mood box or add rows below.
- V17 — Transcript cards aligned to input width. User + Drexler cards distinct accent, shared width + border geometry.
- V18 — Drexler body marker = diamond. User body marker = chevron.
- V19 — Display normalize: strip raw fence markers + language labels from rendered transcript. Non-md fenced code ⇒ Dracula-style syntax color.
- V20 — Save/export emit underlying conversation content, not normalized display.
- V21 — All long text, glyphs, spinner labels, status rows, command rows, Deal Desk rows are display-width bounded.
- V22 — During streaming or synergy animation, input locked until op completes.
- V23 — Non-TTY launch falls back to linear readline output (no Ink).
- V24 — Short terminals suppress oversized startup chrome.
- V25 — Pet stat clamp: every reducer output ∈ [0,100].
- V26 — Pet `applyDecay` returns same identity when no movement (skip disk write). `lastSaved` not bumped so accumulated elapsed crosses threshold.
- V27 — Pet name: NFKC + strip `\p{Cf}` before charset filter. Prevents bidi-override spoof (e.g. U+202E in "Max" → "xaM").
- V28 — Pet cooldown: backward clock skew (`elapsed < 0`) treated as no cooldown; next `stampAction` overwrites stale future stamp.
- V29 — Pet save: atomic temp+rename. tmp unlink on write failure. All errors swallowed (best-effort).
- V30 — `lifetimeDeals` independent of volatile `deals` stat. Decay + spam do not roll back rank.
- V31 — Slash command palette filtered by prefix. Argument-parent commands open chooser.
- V32 — Markdown rendering supports code-block syntax via `cli-highlight` (Dracula-inspired palette).
- V33 — Pet save serialized via async FIFO queue. Concurrent `savePetState` calls run sequentially; never overlap rename. Cross-instance writes guarded by an owned exclusive-create lockfile (`pet.json.lock`, `fs.openSync(..., 'wx')`) containing `pid`, `token`, `createdAt`, and `hostname`; contention returns a structured locked result (best-effort).
- V34 — Lint + format gates: `bun lint` + `bun format:check` pass in CI before publish. ESLint flat config + Prettier check. Ink JSX prop allowlist documented.
- V35 — `petState.saveQueue` MUST drain before process exit (SIGINT/SIGTERM/Ink unmount). Pending writes awaited with timeout ≤ 2s; on timeout the queue generation advances so late abandoned writes cannot supersede newer saves. Lock release is token-owned only: `flushPetSaves()` MUST NOT delete a foreign lock. Dead-pid or TTL-expired locks may be removed and retried once.
- V36 — `prepublishOnly` runs `lint` in addition to `test` + `typecheck`. CI publish workflow matches.
- V37 — CI runs `bun run test:coverage`, producing `coverage/lcov.info`; the lcov file is uploaded as a required workflow artifact.
- V38 — All React hook deps arrays exhaustive (no `react-hooks/exhaustive-deps` warnings). Lint baseline = 0 warnings.
- V39 — UI surfaces sanitized, length-capped `result.error` from `src/llm.ts` to user on non-OK outcomes; `/debug` slash command dumps last N in-memory telemetry frames (default 5). Telemetry/debug output MUST redact authorization headers, bearer tokens, `sk-or-*` keys, local home paths, and long JSON bodies.
- V40 — devDependencies use `^` semver; Bun lockfile provides install-time determinism. (WU-J reviewed exact-pin vs caret; caret retained.)
- V41 — Event spawn: gap ≥6m, ≤1 active at a time. Spawn only when `petMode` on AND not streaming AND not in `/synergy`. Auto-expire at 30s ⇒ no stat change.
- V42 — Event response: 30s wall-clock. `/respond` outside window or w/ invalid choice = local notice, no stat change. Stat delta clamped ±30; final stats clamped [0,100] (§V25). ESC cancels event w/ `happiness -= 5`.
- V43 — Active deals persisted in `pet.json.activeDeals`. Max concurrent 2. Deadline = absolute ms. Expired deals removed at next decay tick; completion adds `reward` to `lifetimeDeals` only (§V30). Failure never decreases rank.
- V44 — `/trade`: gated by RTH 09:30–16:00 local. Once per session via `tradeSession.used`. Seed deterministic per `(date, ticker, side)`; same input ⇒ same outcome. Off-hours and post-use ⇒ local notice, no state change.
- V45 — Synergy: ring buffer `actionHistory` length 4, append per action. Pattern match within 5m end-to-end window. Bonus applied once per recognized window; matched entries cleared. Buffer never grows past 4.
- V46 — Persona injection: pet summary appended to system message content (index 0), not new message (§V1). Summary ≤200 chars, sanitized (no API keys, no paths). Pet mode off ⇒ no addendum. Same redaction rules as §V39.
- V47 — Graveyard: file `~/.drexler/graveyard.json`, atomic temp+rename, capped 50 entries FIFO. Death writes entry BEFORE respawn reset overwrites `name`. Respawn halves `lifetimeDeals`, not zero. Reads tolerate missing/corrupt file (empty array fallback).
- V48 — Inventory: `pet.json.inventory` ∈ ℤ≥0 for {coffee,pastry,charter}. `/buy` rejects if `deals < cost`. `/use` rejects if count = 0. Effects clamp per §V25. Cost decrement only from volatile `deals`; never touches `lifetimeDeals`.
- V49 — Daily review: shown at most once per local-calendar day, gated by `lastReviewAt` < today-midnight-local. Skipped when prior 24h has zero `actionHistory` entries. Renders as transcript card (V17), never blocks input.
- V50 — All new slash commands honor §V6 (in-character unknown), §V7 (empty nudge), §V22 (input lock during stream/synergy), §V31 (prefix filter + arg chooser).

## §T Tasks

| id | status | task | cites |
|---|---|---|---|
| T1 | x | Resolve in-flight edits: `src/ui/PetPanel.tsx` market-board panel row refactor | V17,V21 |
| T2 | x | Add ESLint flat config + Prettier + CI step | V34 |
| T3 | x | Pet save FIFO queue + cross-instance lockfile | V33 |
| T4 | x | Fix Ink UI §V8 violation; surface STREAM_ERROR in App.tsx | V8 |
| T5 | x | App.tsx hook deps exhaustive | V38 |
| T6 | x | Drain `saveQueue` on SIGINT/SIGTERM/unmount (≤2s timeout) | V35 |
| T7 | x | `prepublishOnly` also runs `bun run lint` + `format:check` | V36 |
| T8 | x | Split `src/ui/PetPanel.tsx` into `src/ui/pet/{MarketBoard,AsciiClock,MascotScene,CompactPetPanel,shared}` (barrel re-export) | V21 |
| T9 | x | Format pass: Prettier across src + tests; strict format:check | V34 |
| T10 | x | Lint baseline 30 → 0 warnings | V38 |
| T11 | x | Test speedup: event-driven assertions in `tests/ui-app-state.test.ts` + `tests/ui-live-chrome.test.ts` (no polling) | — |
| T12 | x | Persona lazy-load via `loadPersonaLazy` + preload | — |
| T13 | x | Telemetry: surface `result.error` in UI; `/debug` slash dumps last 5 frames | V39 |
| T14 | x | `CONTRIBUTING.md`: Bun-only dev loop, SPEC discipline, branch naming | — |
| T15 | x | CI: `bun test --coverage` artifact upload | V37 |
| T16 | x | Bundle audit (WU-J): chalk + cli-highlight kept; marked/marked-terminal still wire renderMarkdown (tested) — backlog: drop if renderMarkdown removed | — |
| T17 | x | Stream render throttle (WU-K): 33ms setTimeout on streamTimerRef gates setStreaming; aligns w/ Ink default 30 FPS — verified, no action | V22 |
| T18 | x | devDependencies pin (WU-J): caret retained; Bun lockfile determines install-time tree | V40 |
| T19 | x | Event system: `src/pet/events.ts` schema, scheduler, `/respond` cmd, HUD overlay, ESC cancel | V41,V42,V50 |
| T20 | x | Active Deals: `src/pet/deals.ts` schema, deadline tracker, `/deals` cmd, completion/failure paths | V43,V50 |
| T21 | x | Market trade: `src/pet/trade.ts` seed+resolve, `/trade` cmd, RTH gate, once-per-session enforce | V44,V50 |
| T22 | x | Synergy combos: `src/pet/synergy.ts` ring buffer + detection + bonus reducer; wire into action commit | V45 |
| T23 | x | Persona injection: append sanitized pet summary to system prompt content per turn | V46 |
| T24 | x | Graveyard: `src/pet/graveyard.ts` schema, on-death write, `/graveyard` cmd, FIFO trim | V47 |
| T25 | x | Inventory: schema in `pet.json`, `/buy` + `/use` cmds, item effects, cost/clamp gates | V48,V50 |
| T26 | x | Daily review: `src/pet/review.ts` `lastReviewAt`, render card on launch + `/review` cmd | V49,V50 |
| T27 | x | Tests: unit + integration coverage for T19–T26; deterministic clock + RNG injection | V41–V50 |

## §B Bugs

| id | date | cause | fix |
|---|---|---|---|
