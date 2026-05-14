# Contributing to Drexler

## Prerequisites
- Bun ≥ 1.1 (no Node fallback). Install: `curl -fsSL https://bun.sh/install | bash`
- macOS or Linux (no Windows support; terminal-first)

## Dev loop
- Clone, then: `bun install`
- Run: `bun start` for the local entrypoint. Use `bun link` from the repo when you need the `drexler` command on PATH for local smoke testing.
- Tests: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run format` (writes) or `bun run format:check` (verify)
- All release gates: `bun run prepublishOnly`

## Project structure
- `src/index.ts` — entry
- `src/llm.ts` — OpenRouter streaming
- `src/ui/` — Ink components
- `src/ui/pet/` — pet panel subcomponents
- `src/pet/petState.ts` — pet stat reducers + atomic save
- `prompts/drexler.md` — default persona
- `SPEC.md` — source-of-truth invariants + tasks + bugs

## SPEC discipline
- Read `SPEC.md` before touching code. Invariants in §V are not suggestions.
- Adding a new invariant: append to §V, cite from any new task in §T.
- Found a bug? Add a §B row with date, root cause, and fix. Decide whether a new §V invariant would prevent recurrence.

## Branch + commit conventions
- Branches: `fix/<scope>`, `feat/<scope>`, `chore/<scope>`, `refactor/<scope>`, `docs/<scope>`
- Commits: Conventional Commits. `fix(pet): ...`, `feat(ui): ...`. Reference SPEC tasks/invariants in body when relevant (e.g., `(§T6, V35)`).
- One logical change per PR. CI gates: typecheck, test, lint, format:check.

## Tests
- Framework: `bun:test`. Snapshot tests live alongside `tests/`.
- Add a test for every bug fix and every new public behavior.
- Avoid `setTimeout`/polling; prefer event-driven Promise-based waits (see `tests/ui-app-state.test.ts`).

## Releases
- Run `bun run prepublishOnly`, bump `package.json` version, update `CHANGELOG.md`, tag `vX.Y.Z`, push. CI publishes to npm via the `publish` workflow.
