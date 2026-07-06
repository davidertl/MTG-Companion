# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Prerequisites:** Node.js 22+, Rust 1.83+, Python 3.12+

```bash
npm install          # install JS dependencies

npm test             # full test chain: typecheck + test:ts + test:rust + test:python
npm run typecheck    # tsc --noEmit
npm run test:ts      # vitest run
npm run test:rust    # cargo test --workspace
npm run test:python  # unittest discover in services/archidekt-connector/tests

npm run verify:all   # full gate: npm test + api:smoke + arenac:build + arenac:smoke + paperc:build
npm run arenac:build # cargo build -p mancutg-arenac
npm run arenac:smoke # bash scripts/arenac_smoke.sh (build + runtime CLI smoke)
npm run api:start    # start MancuTG-backend on port 8787
npm run api:smoke    # API smoke test
npm run desktop:help # cargo run -p mancutg-arenac -- --help
npm run paperc:dev   # run the PaperC move-logging PWA (vite dev server)
npm run paperc:build # build the PaperC static bundle to apps/paperc/dist
```

Key ArenaC CLI subcommands (`cargo run -p mancutg-arenac -- <cmd>`):
```bash
bootstrap <log-path>                          # one-shot ingest of an Arena log
watch-log <log-path> [store-path] [--follow]  # continuous live tail with --follow
import-card-db <scryfall-bulk.json> [db-path] # offline import of Scryfall Oracle Cards bulk data
card-db-status [db-path]                       # local card DB row count + path
sync-now [store-path] [settings-path]          # drain the sync outbox (consent-gated; no-op if sync off)
inspect-store / reprocess-session / export-backup / import-ios-file / import-ios-folder
```
Analysis currently runs through the `analyze_match` Tauri command (and the W5.2
e2e script); a thin `analyze-match` CLI subcommand may be added by W5.2.

Run a single Rust test:
```bash
cargo test -p <crate-name> <test_name>
```

Run a single TS test file:
```bash
npx vitest run apps/desktop/tests/<file>.spec.ts
```

## Architecture

This is a multi-language monorepo for **MancuTG-Companion**, an offline-first MTG Arena desktop companion. The three layers are:

### Rust crates (`crates/`)
- `core-domain` — shared domain types: `LogSession`, `MatchRecord`, `CollectionSnapshot`, `PlatformTag`, `EventType`, etc.
- `core-parser` — log-only parser (`parse_log_lossy`) that converts Arena log fragments into typed events and captures unknown events
- `core-store` — SQLite-backed local event store and projections; also manages log checkpoints and ingest diagnostics
- `core-sync` — consent-gated sync outbox (`sync_outbox` table, migration `002_outbox.sql`): enqueue local events on ingest and drain them in batches to the backend `/events` endpoint with a per-batch `idempotencyKey`
- `core-carddb` — offline card knowledge: streaming import of the Scryfall "Oracle Cards" bulk file into a local `cards.sqlite`; lookups by `arena_id` and card name; no runtime network calls
- `core-gamestate` — pure, deterministic reconstruction: `GameTimeline::from_events` folds Arena- or Paper-sourced gameplay events into per-turn `TurnSnapshot`s (hidden info modelled honestly)
- `core-analysis` — pure rules checker + suggestion engine: `analyze(timeline, carddb) -> Vec<Finding>`; findings carry severity, confidence, CR `ruleRefs`, and an `audience`; never issues autonomous rulings

### Desktop app (`apps/desktop/`)
- `src-tauri/` — Rust binary (`mancutg-arenac`); CLI + Tauri command entry point wrapping the core crates; CLI subcommands include `bootstrap`, `watch-log --follow` (continuous live watcher), `sync-now`, `import-card-db`, `card-db-status`, `import-ios-file`, `import-ios-folder`, `inspect-store`, `reprocess-session`, `export-backup`; Tauri commands add `analyze_match`, watcher start/stop/status, and consent toggles
- `src/app/` — React application shell (`ArenaAppShell.tsx`) and its state builder (`buildArenaAppShellState.ts`)
- `src/routes/` — one folder per view: `collection`, `decks`, `diagnostics`, `draft`, `history`, `imports`, `inventory`, `privacy`, `settings`, `setup`; each exports a route state builder
- `src/lib/` — shared logic split into `decks/`, `export/`, `network/`, `query/`
- `src/components/` — shared UI primitives (`ShellPanel`, `SummaryMetric`, `ActionCluster`)
- `tests/` — vitest specs; one spec per route/feature, plus a `smoke/` directory

### PaperC app (`apps/paperc/`)
- Runnable browser PWA (Vite + React) for logging a physical game move-by-move (`npm run paperc:dev`, `npm run paperc:build`). `src/state/` holds the append-only game log (undo-as-correction) + local persistence; `src/sync/` is the offline outbox posting to `/events`; `src/capture|events|tournaments` are the shared-contract emission layer. Every logged move becomes a `paperc.observation.detected` event with a typed `gameActions` payload, so paper games feed the same reconstruction/analysis engines as Arena logs.

### Backend service (`services/`)
- `api/` — TypeScript Node.js server (`node --experimental-strip-types`); anonymous routes: `GET /health`, `POST /events`, `GET /events?cursor=` (cursor pull), `POST /sync`, `POST /media/sessions`, `GET /integrations/archidekt/:deckId`. Auth/roles (`src/auth/`): opaque bearer tokens + per-tournament roles (organizer/referee/player/spectator); tournament-scoped routes require auth (`POST /auth/register`, `POST /tournaments`, `POST /tournaments/:id/members`, `GET /tournaments/:id/role`). `src/domain/findingsService.ts` enforces **referee-only findings visibility** server-side via a table-driven `{mode × audience × role}` matrix (`GET /tournaments/:id/findings`, `POST /tournaments/:id/findings/:findingId/review`). Persists to SQLite (`.json` store path stays a compat fallback).
- `archidekt-connector/` — Python read-only Archidekt adapter (`pyrchidekt`-compatible)
- `worker/` — background job foundation

### Shared contracts (`packages/shared-schema/src/`)
Zod-validated schemas for: `events`, `imports`, `privacy`, `archidekt`, `paperc`, `tournaments`, `media`, `analysis` (findings/suggestions with `audience`), `roles`, and `gameActions` (typed action payloads shared by Arena and Paper streams). These are the cross-boundary contracts between the Rust core, the desktop TS layer, and the backend.

## Key invariants

- **Offline-first:** ArenaC works without a backend or account. Sync, telemetry, and Archidekt are optional and gated by `PrivacySettings`.
- **Log-only:** Arena integration is read-only via log parsing only — no game client hooks or network interception.
- **iOS import:** supported via file drag-and-drop or folder import with deduplication and `ios` platform tagging; no live tracking on device.
- **Backend is optional:** the `services/api` server handles sync aggregation but the desktop binary is fully self-contained.
- **Human-in-the-loop analysis:** the analysis engine never issues autonomous rulings — it emits *findings* (severity, confidence, CR `ruleRefs`). Findings carry an `audience`, and referee-only findings are enforced **server-side** so they reach referee/organizer roles only, never players.
- **MancuTG-PaperC** is now a runnable move-logging PWA (`apps/paperc/`); `packages/shared-schema/src/paperc.ts` defines its typed action contracts. (Its video/camera pipeline remains a later, out-of-scope track.)

## Docs

- `docs/architecture/unified-mtg-companion-architecture.md` — product and target architecture
- `docs/privacy/data-flow.md` — documented data flow for offline, sync, card-DB import, analysis-findings, and referee-only paths
- `docs/release/mancutg-companion-1.0-checklist.md` — full 1.0 release checklist (Arena + Paper + analysis + referee mode + card DB + sync)
- `docs/release/mancutg-arenac-mvp-checklist.md` — historical ArenaC MVP release checklist
