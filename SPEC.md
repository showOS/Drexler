# SPEC — Drexler

## §G Goal

Bun + TypeScript terminal chat app. Ink UI. Corporate-executive AI persona over OpenRouter chat-completion models. Terminal-native, fast, polished. Pet-mode dashboard layered on chat.

## §C Constraints

- Runtime: Bun ≥ 1.1, TypeScript source, React 19 + Ink 7 terminal UI.
- Terminal-only: no web server, GUI, DB, browser client.
- Chat-first: no model tool calls, no model-side fs. Multimodal (text + image attachments) opt-in per turn via §I Attachments; image turns gated by vision-capable model (§V71).
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
| `/achievements` | list earned badges (V51) |
| `/perks` | list earned + available perks (V52) |
| `/perk <id>` | spend a promotion point on a perk (V52) |
| `/streak` | show current daily streak (V53) |
| `/challenge` | show today's challenge progress (V54) |
| `/log` | print recent in-session pet notifications (V55) |
| `/pitch` | timing mini-game (V57) |
| `/negotiate` | text-choice mini-game (V57) |
| `/archetype <closer\|networker\|operator>` | pick specialization at vp+ (V61) |
| `/attach <path>` | stage file as attachment for next send (V68,V69,V73) |
| `/paste` | capture next bracketed-paste payload as attachment instead of input (V70) |
| `/attachments` | list pending attachments; ESC clears (V73) |

Palette opens on `/`. Argument choosers: `/theme`, `/startup`, `/retry`, `/export`, `/model`, `/respond`, `/trade`, `/buy`, `/use`, `/perk`, `/archetype`, `/attach`.

### Pet state — `src/pet/petState.ts`

- File: `~/.drexler/pet.json` (atomic temp+rename, swallow errors).
- Stats: `hunger`, `happiness`, `energy`, `deals` ∈ [0,100]. Plus `lastSaved`, `dead?`, `name?`, `createdAt?`, `lastActionAt?`, `lifetimeDeals?`, `activeDeals?`, `actionHistory?`, `inventory?`, `tradeSession?`, `lastReviewAt?`, `perks?`, `perkPoints?`, `streak?`, `dailyChallenge?`, `worldEvent?`, `archetype?`, `boss?`, `minigame?`, `achievementProgress?`.
- Decay per hour: hunger 15, happiness 8, energy 10, deals 5. Applied over `now − lastSaved`.
- Cooldown per action: `PET_COOLDOWN_MS = 60_000` ms (lowered from 90s in P17). Perks (`quick_recovery`) can reduce further.
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

### Achievements — `src/pet/achievements.ts`

- Persistent unlock list at `~/.drexler/achievements.json`. Array of `{id, unlockedAt}` deduped by id.
- ~20 launch badges: `first_blood` (first action), `intern_to_md` (reach MD rank), `audit_survivor_5` (handle 5 audit events), `trade_winner_10` (win 10 /trades), `streak_7` (7-day streak), `boss_quarterly` (beat first boss), `synergy_3` (trigger all 3 patterns), `pipeline_pro` (close 25 deals), `cohort_2` (visit graveyard with 2+ entries), `chartered_3` (use 3 charters), etc.
- Unlock points: invoked from action hooks + event hooks + trade hooks. Pure check function per id.
- `/achievements` slash prints earned + locked summary.

### Perks / skill tree — `src/pet/perks.ts`

- `pet.json.perks: string[]`. `pet.json.perkPoints: number` (unspent).
- Earn 1 point per rank-up (forward only — decay-induced rank drops do not refund).
- Fixed catalog: `slow_decay`, `quick_recovery`, `big_meals`, `trade_eye`, `pipeline`, `chartered`, `iron_liver`, `rainmaker`.
- `/perks` lists earned + available. `/perk <id>` spends one point.
- Effects compose with existing reducers via `getPerkMultiplier(perks, key)`:
  - `slow_decay` ⇒ decay ×0.8
  - `quick_recovery` ⇒ cooldown −30s
  - `big_meals` ⇒ feed + pastry effect ×1.5
  - `trade_eye` ⇒ trade win bit OR-ed with extra bias
  - `pipeline` ⇒ MAX_ACTIVE_DEALS 2→3
  - `chartered` ⇒ tradeSession bonusAvailable default true each session
  - `iron_liver` ⇒ coffee energy +50%
  - `rainmaker` ⇒ synergy bonus deltas ×1.5

### Streaks + Daily challenge — `src/pet/streaks.ts`

- `pet.json.streak: {lastActiveDate, count, bestCount}`. Bumped once per local-day on first action. Skip a day ⇒ count resets to 0; best preserved.
- Streak bonus: every 3-day milestone awards +10 lifetimeDeals once per milestone (tracked via best).
- `pet.json.dailyChallenge: {date, kind, target, progress, rewarded}`.
- Kinds: `close_deals_2`, `win_trade`, `survive_2_events`, `synergy_1`, `pet_action_10`.
- Roll once per local-day on /pet on. Reward on completion = 25 deals + 1 charter, set `rewarded:true`.
- `/streak` and `/challenge` slashes print status.

### Notification log — `src/pet/notificationLog.ts`

- In-memory ring buffer length 30 of `{at, kind, message}`. Cleared on process exit.
- Append from: event spawn, deal completion/expire, synergy detection, promotion, badge unlock, world event start/end, boss step.
- `/log` prints last 20 entries in transcript card. No file persistence (V55).

### Mascot rank variants — `src/ui/pet/MascotScene.tsx`

- Pure function of `getPetRank(stats)`. Sprite variants:
  - intern: minimal hoodie sprite
  - analyst: blazer + tie
  - associate: suit
  - vp: pinstripes
  - md: penthouse silhouette with skyline frame
- Selection at render time; no extra perf cost (variants are static strings).

### Mini-games: pitch + negotiate — `src/pet/minigames.ts`

- Both store last-played in `pet.json.minigame: {lastPitchAt?, lastNegotiateAt?}`. Cooldown 5m each.
- `/pitch`:
  - Cycles ASCII bar 0..7 (`▁..█`). User presses Enter when peak shown.
  - Hit if bar in [6, 7]. Hit ⇒ +20 happiness, +15 deals. Miss ⇒ -5 happiness.
  - Sequence is deterministic from seed (`now`-derived), 16 frames at 200ms.
- `/negotiate`:
  - Scenario from fixed pool of 6. User picks 1|2|3 within 30s.
  - Choice options gated by stats: bold needs happiness ≥ 60, aggressive needs energy ≥ 60.
  - Outcome stat-deltas ±20.

### World events / seasonal modifiers — `src/pet/world.ts`

- `pet.json.worldEvent: {kind, startedAt, expiresAt}`.
- Kinds: `market_crash`, `ipo_mania`, `audit_week`, `holiday`.
- 5% spawn chance on /pet on (when no active world event). Duration 2h–8h.
- Modifiers compose with existing reducers:
  - `market_crash` ⇒ trade loss deltas ×2; win deltas same.
  - `ipo_mania` ⇒ work `deals` gain ×1.5.
  - `audit_week` ⇒ event spawn cadence halved gap.
  - `holiday` ⇒ decay rate ×0.5.
- Banner narrated on start + end via notification log.

### Boss encounters — `src/pet/boss.ts`

- `pet.json.boss: {id, step, startedAt, deadline}`.
- Triggered once per pet life at first promotion to `vp`+ via dedicated hook.
- Steps for `quarterly_earnings`:
  1. complete 1 /work
  2. win 1 /trade
  3. respond to 1 audit event
  4. /praise within 30m from step 1
- Completion: +200 lifetimeDeals, unlock `boss_quarterly` achievement.
- Failure / deadline: -15 happiness, removed.

### Cooldown + decay tuning — P17

- `PET_COOLDOWN_MS` lowered 90_000 → 60_000.
- `applyDecay` accepts effective rate multiplier. When session is active (`now - latest actionHistory.at < 5m`), rate ×0.5. Off-session = full.
- Perk `slow_decay` composes with session multiplier (e.g. 0.5 × 0.8 = 0.4).

### Archetypes — P18

- `pet.json.archetype?: 'closer'|'networker'|'operator'`. Set once at first VP promotion via `/archetype`. Immutable after.
- Reducer modifiers:
  - `closer` ⇒ applyWork deltas ×1.5; applyPlay deltas ×0.75
  - `networker` ⇒ applyPlay deltas ×1.5; applyWork deltas ×0.75
  - `operator` ⇒ applyRest deltas ×1.5; decay rate ×0.9

### Attachments — `src/attach/*` (new)

- Sources of intake:
  - Drag/drop: terminal-dropped file path lands as text in the input line. When the entire input resolves to a single absolute path to a regular file, InputBox offers attach (Enter) or send-as-text (ESC).
  - Bracketed paste: xterm bracketed paste (`ESC[200~ … ESC[201~`) intercepted. Payload > 4 KiB or containing NUL bytes ⇒ attach prompt instead of inline insert.
  - `/attach <path>`: explicit. Argument chooser shows recent files + tab-completion. Tilde + env-var expanded.
  - `/paste`: arms a one-shot capture so the next bracketed-paste payload is staged as `text/plain` attachment regardless of size.
- Schema: `Attachment = { kind: 'text'|'image', filename, mime, sizeBytes, sha256, payload: Buffer }`. Lives in `pendingAttachments: Attachment[]` on the App state. Cleared on send, `/clear`, or ESC over the chip strip.
- Allowlist:
  - Text mimes (`text/*`, `application/json`, `application/x-yaml`, `application/toml`) and extensions `.md|.txt|.json|.yaml|.yml|.ts|.tsx|.js|.jsx|.py|.go|.rs|.sh|.toml|.csv|.log`.
  - Image mimes `image/png|image/jpeg|image/webp|image/gif` (still frame only).
  - Mime sniffed by magic bytes; extension used only as tiebreak.
- Size caps: text ≤ 256 KiB/file, image ≤ 4 MiB/file, total ≤ 8 MiB/message, ≤ 4 attachments/message.
- Path safety: regular files only. Reject symlinks, FIFOs, sockets, devices, traversal (`..`), and any path under `~/.ssh`, `~/.aws`, `~/.config/drexler`, or any `.env*` basename.
- Send shape:
  - Text attachments append to the user message as a fenced block with `filename` info-string. Token estimate folded into `/history` accounting.
  - Image attachments switch the outbound message to OpenAI content-array form: `content: [{type:'text', text}, {type:'image_url', image_url:{url:'data:<mime>;base64,<...>'}}, …]`. Text-only sends keep the existing string-content form.
- Vision-model gate: image attachments require a vision-capable model. `src/llm.ts` exposes `MODEL_CAPS: Record<modelId, {vision:boolean}>`. Non-vision + image ⇒ in-character refusal + suggest `/model`. No HTTP issued.
- UI: chip strip rendered above InputBox prompt — one chip per attachment showing icon, filename, size, sha256 prefix. `/attachments` slash prints the same list as a transcript card. ESC over input with chips present clears chips (does not exit input).
- Persistence: attachments live in memory only. Never written to `pet.json`, `config.json`, graveyard, notification log, or transcript history slot. Exports (`/save`, `/export`) render placeholders only: `[attachment: <filename> (<size>) sha256:<8>]`. Image bytes never written to disk by Drexler.

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
- V51 — Achievements: append-only `~/.drexler/achievements.json`, deduped by `id`. Atomic temp+rename writes. Reads tolerate missing/corrupt file (empty array fallback). Unlocking is idempotent — re-unlocking a known id is a no-op, never duplicates the entry.
- V52 — Perks: 1 promotion point granted per forward rank transition (decay-induced rank drops never refund). `perkPoints` floor at 0; `/perk <id>` rejected unless point available and perk not already owned. Effects compose multiplicatively with archetype + world-event modifiers; final stats clamp per §V25.
- V53 — Streaks: anchored to local-calendar day via `lastActiveDate`. Same-day actions never bump count. Missing a day resets `count` to 0; `bestCount` is monotonic non-decreasing. Streak milestone reward (every 3 days) credited at most once per `bestCount` value.
- V54 — Daily challenge: rolls once per local-day on first `/pet on` of day. `kind`/`target` immutable until day rollover. `rewarded:true` makes re-completion a no-op. Reward applied via volatile `deals` + inventory only — never touches `lifetimeDeals`.
- V55 — Notification log: in-memory ring buffer ≤ 30 entries. Never persisted. Cleared on Ink unmount. `/log` output is read-only — never mutates pet state.
- V56 — Mascot rank variants: pure function of `getPetRank(stats)`. Variant pick happens at render time (no caching state); same rank ⇒ same sprite. Variants must respect existing display-width budget (§V21).
- V57 — Mini-games: `/pitch` and `/negotiate` honor 5m cooldown via `pet.json.minigame.lastPitchAt|lastNegotiateAt`. Backward clock skew handled like §V28. Outcomes computed locally; never call the model.
- V58 — World events: at most 1 active at a time, persisted in `pet.json.worldEvent`. Expired events removed at next decay tick. Modifiers compose multiplicatively with perk + archetype multipliers; ordering deterministic = `base × perk × archetype × world`. Stat clamp per §V25.
- V59 — Boss encounters: at most 1 active per pet life, persisted in `pet.json.boss`. Steps must complete in order before `deadline`. Step completion idempotent — repeating a satisfied step doesn't advance. Failure or deadline ⇒ removed; never decreases `lifetimeDeals`.
- V60 — `PET_COOLDOWN_MS = 60_000`. `applyDecay` accepts effective multiplier ∈ [0,1]; default 1. Caller composes session × perk × world multipliers and passes the product. Multiplier 0 ⇒ no decay; never inverts (negative multipliers rejected → fallback 1).
- V61 — Archetype: chosen at first `vp` promotion via `/archetype`. Immutable once set. `pet.json.archetype` survives respawn. Reducer multipliers applied AFTER base reducer math, BEFORE clamp.
- V62 — All new commands honor §V6/§V7/§V22/§V31 same as §V50.
- V63 — `updatePetStats` reducer body is pure: no `addItem`, `setX`, `appendNotification`, no fs IO, no `setPetStats`. Narration, badge evaluation, and notification log writes happen in post-commit effects watching `petStats`. (StrictMode dev double-invoke is the witness — any side effect fires twice and breaks counts.)
- V64 — Pet-mode persistent files (`pet.json`, `achievements.json`, `graveyard.json`) write through a single atomic-write surface. `pet.json` uses the petState save queue + owned lockfile; `achievements.json` + `graveyard.json` use `src/pet/fileLock.ts` (`withJsonFileLock`). New persistent files MUST pick one of those two paths — no module re-implements the temp+rename+lock pattern.
- V65 — Achievement reads in the hot path are cached. The first `loadAchievements()` after process boot may read disk; subsequent `isAchievementUnlocked` / `loadAchievements` calls hit an in-memory mirror until `unlockAchievement` mutates it. The cache invalidates only on (a) successful unlock, (b) explicit reload, (c) failed write.
- V66 — Non-deterministic primitives (`Math.random`) under `src/pet/` and pet-mode call sites in `src/ui/App.tsx` are injectable via an `rng?: () => number` parameter that defaults to `Math.random`. Inline `Math.random()` at the use site is banned outside the default-parameter line itself. The shared helper lives at `src/pet/rng.ts` (`defaultRng()` / `pickInt(rng, n)`).
- V67 — Pet-mode slash handlers in `src/ui/App.tsx` are extracted into co-located modules (`src/ui/pet/handlers/*.ts` or a single `src/ui/pet/petCommands.ts`) so `App.tsx` stays ≤ 2400 LOC. Each handler is testable against a stubbed `PetHandlerContext` without rendering React.
- V68 — Attachment path safety: regular files only. Reject symlinks, non-regular files, traversal (`..`), and deny-list (`~/.ssh`, `~/.aws`, `~/.config/drexler`, any `.env*` basename). Rejection ⇒ in-character local notice (§V6), no model call, no fs read of payload.
- V69 — Attachment size + count caps: text ≤ 256 KiB/file, image ≤ 4 MiB/file, total ≤ 8 MiB/message, ≤ 4 attachments/message. Over-cap rejected pre-send with local notice; partial loads discarded.
- V70 — Bracketed paste: payloads > 4 KiB OR containing NUL bytes prompt attach-vs-inline before insertion. Raw payload bytes never echoed to telemetry, exports, or notification log (truncated body + sha256-8 prefix per §V39 redaction rules).
- V71 — Image attachments require a vision-capable model per `MODEL_CAPS[modelId].vision`. Image + non-vision model ⇒ in-character refusal + suggest `/model`; zero HTTP requests issued. Aliases `31b` / `26b` are not vision-capable.
- V72 — Multimodal message shape: presence of any image attachment switches the request body to OpenAI content-array form `[{type:'text'},{type:'image_url',…}]`. Pure-text turns (no attachments OR text-only attachments inlined) keep the existing string-content form — back-compat for all V8/V46 paths.
- V73 — Attachments are in-memory per session only. Never persisted to `pet.json`, `config.json`, `graveyard.json`, `achievements.json`, or notification log. Transcript history slot stores the synthesized user message text only. Exports/saves emit `[attachment: <filename> (<size>) sha256:<8>]` placeholders — never raw bytes, never base64. Cleared on send, `/clear`, ESC over chip strip, and Ink unmount.

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
| T28 | x | Achievements: `src/pet/achievements.ts` file IO, ~20 badge defs, unlock hooks across event/trade/deal/synergy/promotion paths, `/achievements` cmd | V51,V62 |
| T29 | x | Perks: `src/pet/perks.ts` catalog, point ledger, `/perks` + `/perk <id>` cmds, multiplier helpers wired into reducers and trade | V52,V62 |
| T30 | x | Streaks + daily challenge: `src/pet/streaks.ts`, daily roll on `/pet on`, `/streak` + `/challenge` cmds, milestone reward | V53,V54,V62 |
| T31 | x | Notification log: `src/pet/notificationLog.ts` ring buffer, `/log` cmd, integration hooks at event/deal/synergy/promotion/badge/world/boss | V55,V62 |
| T32 | x | Mascot rank variants: extend `src/ui/pet/MascotScene.tsx` w/ 5 sprite tiers selected by `getPetRank` | V56 |
| T33 | x | Mini-games: `src/pet/minigames.ts` pitch + negotiate, `/pitch` + `/negotiate` cmds, 5m cooldown stamp | V57,V62 |
| T34 | x | World events: `src/pet/world.ts`, spawn on `/pet on`, expiry tick, modifiers composed into decay + trade + spawn cadence | V58,V62 |
| T35 | x | Boss encounters: `src/pet/boss.ts`, trigger at first vp promotion, step state machine, integration in action/trade/event hooks | V59,V62 |
| T36 | x | Cooldown + decay tuning: `PET_COOLDOWN_MS=60_000`, `applyDecay` multiplier param, session-active detection, perk/world composition | V60 |
| T37 | x | Archetypes: `src/pet/archetype.ts`, `/archetype <id>` cmd at vp+, reducer multipliers, persist across respawn | V61,V62 |
| T38 | x | Tests: unit + integration coverage for T28–T37; deterministic clock + RNG injection; verify multiplier composition ordering (§V58) | V51–V62 |
| T39 | x | Pure reducer guard: decay tick switched to precompute pattern (read ref, compute next, dispatch fixed value, narrate + badge eval AFTER setState). Reducer body is now side-effect free; StrictMode double-invokes cannot double-fire notifications. | V63,B7 |
| T40 | x | Achievement read cache: module-scope mirror seeded lazily in `loadAchievements`. `reloadAchievements` exported for tests + manual invalidation. `unlockAchievement` refreshes cache on every outcome. Cache-hit + post-unlock tests added. | V65,B8 |
| T41 | x | Atomic-write contract documented at the top of `src/pet/petState.ts` — explains why `pet.json` keeps its own queue + owned lockfile pipeline while `achievements.json` / `graveyard.json` use `withJsonFileLock`. Both are atomic temp+rename; new files must pick one path. | V64,B9 |
| T42 | x | `src/pet/rng.ts` exposes `defaultRng`, `pickInt`, `pick`, `seededRng`. Refactored `review.ts:75` (oneLinerPick), `App.tsx` pick helper, death variant, and vibe roll to thread an injectable rng. Inline `Math.random()` retained only at default-parameter slots. Tests cover deterministic + bounds behavior. | V66,B10 |
| T43 | x | `composeDecayMultiplier(stats, now)` helper at the top of `src/ui/App.tsx` unifies the four-source multiplier math (session × perk × world × archetype). Both `applyPetAction` and the decay tick call the same helper, eliminating duplicate ordering bugs. useMemo was not necessary — the helper is constant-time and not in a render hot path. | V60 |
| T44 | ~ | Partial: view-only slash handlers (`/achievements`, `/perks`, `/streak`, `/challenge`, `/log`, `/review`, `/graveyard`, `/deals`) extracted to `src/ui/pet/petViewCommands.ts` with `handlePetViewSlash(slashCommand, ctx)` dispatch + standalone tests. App.tsx 2796 → 2774 LOC. Stateful handlers (`/perk`, `/archetype`, `/trade`, `/buy`, `/use`, `/respond`, `/pitch`, `/negotiate`, action mutators) still inline because they need the `setPetStats` + ref + timer plumbing; full extraction to ≤ 2400 LOC remains follow-up. | V67,B11 |
| T45 | x | Tests added: `tests/pet-rng.test.ts` (deterministic + bounds), `tests/pet-view-commands.test.ts` (dispatch), achievements cache-hit test, review rng-injection test. StrictMode regression covered indirectly via the precompute pattern in T39 (reducer body is empty so double-invoke is provably safe). | V63,V65,V66 |
| T46 | x | Bench added at `tests/pet-perf-bench.test.ts`. Opt-in via `DREXLER_PERF=1`. Composed action step (compose decay + applyDecay + applyWork + stamp + accrue + history + tickDeals + detectSynergy) runs in p50 ≈ 0.001ms, p99 ≈ 0.015ms, max 0.345ms on a developer box — well under the 1ms p99 target. | V60 |
| T47 | x | `src/attach/types.ts`: `Attachment` shape, allowlist + cap constants, `AttachError` union. Single source of truth for limits in V68/V69. | V68,V69,V73 |
| T48 | x | `src/attach/loader.ts`: `loadAttachment(path)` — stat-then-read, mime sniff (magic bytes), extension allowlist tiebreak, deny-list path check, size cap enforcement. Returns `Result<Attachment, AttachError>`. No I/O on rejected paths beyond stat. | V68,V69 |
| T49 | x | `src/attach/intake.ts` + `src/ui/InputBox.tsx`: pure detection helpers (`splitBracketedPaste`, `classifyPaste`, `isLikelyDroppedPath`, `unquoteDroppedPath`) and chip-strip render above the prompt. App.tsx wiring of state + ESC-clear + send-time inclusion rolled into T51 alongside slash dispatch (same state plumbing). | V70 |
| T50 | x | `src/llm.ts`: `MODEL_CAPS` registry + `isVisionCapable()` + `buildOutboundMessages()` (content-array when images present, string content otherwise) + pre-flight vision gate in `streamChat` (zero HTTP on refusal). `StreamResult.visionRequired` flag for UI surfacing. Aliases `31b`/`26b` marked non-vision. | V71,V72 |
| T51 | x | `src/commands.ts` + palette + App.tsx wiring: `/attach`, `/paste`, `/attachments` slash dispatch + pendingAttachments state + ESC-clear + drag-drop path detect (in onSubmit) + bracketed-paste interception (paste >4 KiB or NUL routes to attach via `loadAttachmentFromBuffer`) + send-time inclusion (text fenced blocks + image placeholders into history; image bytes via attachments param to streamChat) + chip strip prop to InputBox. Recent-files chooser deferred (manual /attach <path> only). | V62,V68,V70 |
| T52 | x | Export + transcript-history sanitizer: `src/attach/sanitize.ts` regex strips text-attachment fences (info-string tagged `filename= size= sha256=`) and substitutes `[attachment: <filename> (<size>) sha256:<8>]` placeholders. Wired into persist (`buildSavedSession`), `/save` (md), `/export` (md/txt/json/html), `/copy[-last]`, `/expand`, `/quote`. Image attachments already arrive in synthesized text as that placeholder form. | V73 |
| T53 | x | Tests added: `tests/attach-loader.test.ts` (path-safety matrix incl. symlink/traversal/deny-list/.env/.ssh, size cap edges, sniff, buffer loader), `tests/attach-intake.test.ts` (bracketed-paste split + classify + drop-path heuristic + unquote), `tests/attach-llm.test.ts` (MODEL_CAPS coverage, vision-gate no-HTTP refusal, multimodal body shape vs string-content back-compat), `tests/attach-sanitize.test.ts` (fence→placeholder replacement, untagged fences pass through). +53 tests; full suite 830 pass / 0 fail; lint + format clean. | V68,V69,V70,V71,V72,V73 |

## §B Bugs

| id | date | cause | fix |
|---|---|---|---|
| B1 | 2026-05-14 | Event scheduler used render-relative timers and could spawn inside the minimum gap or after busy deferral without a durable due time. | Added explicit next-event due time, 6m floor, and end-time rescheduling after response/cancel/expiry. |
| B2 | 2026-05-14 | Deal settlement checked completion before deadline expiry and decay ticks did not settle expired active deals. | Decay tick now calls `tickDeals(..., null, now)` and expired deals fail before same-tick completion. |
| B3 | 2026-05-14 | Pipeline, meal, trade, charter, coffee, and mini-game perks/progress were partially session-only or inert. | Wired perk effects and persisted achievement progress counters in `pet.json`. |
| B4 | 2026-05-14 | Persisted pet extension fields accepted unknown challenge/world/boss/perk values and stale oversized arrays. | Hardened parsing, deduped perks, normalized trade seeds, and capped loaded deals to the effective cap. |
| B5 | 2026-05-14 | Daily challenge rewards could be applied from multiple external call sites. | Made `bumpDailyChallenge` the single reward transition and removed repeated App-level reward application. |
| B6 | 2026-05-14 | Achievements and graveyard append paths used unlocked read-modify-write sequences. | Added shared lock/temp/rename helper for append-style JSON files. |
| B7 | 2026-05-14 | Decay-tick `updatePetStats` reducer calls `addItem` + `appendNotification` + `evaluateProgressBadges` from inside the setState updater. React 19 StrictMode dev double-invokes the reducer, so deal-expiration and world-event-window narration can fire twice and badge unlocks can attempt double writes. | V63 — narration + badge eval move into a post-commit `useEffect` that diffs prev→next petStats. (T39) |
| B8 | 2026-05-14 | `isAchievementUnlocked` and `loadAchievements` perform synchronous fs reads on every call; `applyPetAction` issues 4–5 of these per click. Hot-path disk IO plus race risk on concurrent unlocks. | V65 — module-scope in-memory mirror lazily seeded on first call, invalidated on successful unlock or explicit reload. (T40) |
| B9 | 2026-05-14 | `petState.ts` duplicates the atomic temp+rename + owned lockfile pipeline while `src/pet/fileLock.ts` exposes `withJsonFileLock` for the same purpose. Divergent implementations risk drift; behavior differences are undocumented. | V64 — either migrate `pet.json` writes through `withJsonFileLock` or annotate the deliberate divergence in petState.ts header + spec. (T41) |
| B10 | 2026-05-14 | Inline `Math.random()` calls in `src/pet/review.ts:75`, `src/ui/App.tsx:293` (pick helper), and `src/ui/App.tsx:1192` (death variant) defeat deterministic testing and StrictMode replay parity. | V66 — `src/pet/rng.ts` exposes `defaultRng()`/`pickInt(rng,n)`; all use sites accept an injectable rng with `Math.random` only at default-parameter slots. (T42) |
| B11 | 2026-05-14 | `src/ui/App.tsx` is 2796 LOC and aggregates every pet-mode slash handler, mini-game state machine, scheduler, and persistence callback in one component body. Maintenance + change blast radius hazard. | V67 — extract handlers to `src/ui/pet/petCommands.ts` (or `handlers/*.ts`) so App.tsx ≤ 2400 LOC and each handler is testable against a stub context. (T44) |
