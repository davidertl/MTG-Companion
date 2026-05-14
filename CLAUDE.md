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

npm run arenac:build # cargo build -p mancutg-arenac
npm run arenac:smoke # bash scripts/arenac_smoke.sh (build + runtime CLI smoke)
npm run api:start    # start MancuTG-backend on port 8787
npm run api:smoke    # API smoke test
npm run desktop:help # cargo run -p mancutg-arenac -- --help
```

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
- `core-sync` — outbox/sync objects for optional backend synchronisation

### Desktop app (`apps/desktop/`)
- `src-tauri/` — Rust binary (`mancutg-arenac`); CLI entry point wrapping `core-parser`/`core-store`; provides `bootstrap`, `import-ios-file`, `import-ios-folder`, `inspect-store`, `reprocess-session`, `export-backup` commands
- `src/app/` — React application shell (`ArenaAppShell.tsx`) and its state builder (`buildArenaAppShellState.ts`)
- `src/routes/` — one folder per view: `collection`, `decks`, `diagnostics`, `draft`, `history`, `imports`, `inventory`, `privacy`, `settings`, `setup`; each exports a route state builder
- `src/lib/` — shared logic split into `decks/`, `export/`, `network/`, `query/`
- `src/components/` — shared UI primitives (`ShellPanel`, `SummaryMetric`, `ActionCluster`)
- `tests/` — vitest specs; one spec per route/feature, plus a `smoke/` directory

### Backend service (`services/`)
- `api/` — TypeScript Node.js server (`node --experimental-strip-types`); routes: `GET /health`, `POST /events`, `POST /sync`, `POST /media/sessions`, `GET /integrations/archidekt/:deckId`; persists to a JSON file at `MANCUTG_BACKEND_STORE_PATH`
- `archidekt-connector/` — Python read-only Archidekt adapter (`pyrchidekt`-compatible)
- `worker/` — background job foundation

### Shared contracts (`packages/shared-schema/src/`)
Zod-validated schemas for: `events`, `imports`, `privacy`, `archidekt`, `paperc`, `tournaments`, `media`. These are the cross-boundary contracts between the Rust core, the desktop TS layer, and the backend.

## Key invariants

- **Offline-first:** ArenaC works without a backend or account. Sync, telemetry, and Archidekt are optional and gated by `PrivacySettings`.
- **Log-only:** Arena integration is read-only via log parsing only — no game client hooks or network interception.
- **iOS import:** supported via file drag-and-drop or folder import with deduplication and `ios` platform tagging; no live tracking on device.
- **Backend is optional:** the `services/api` server handles sync aggregation but the desktop binary is fully self-contained.
- **MancuTG-PaperC** is a reserved product name for a future paper card tracking app; the `apps/paperc/` skeleton and `packages/shared-schema/src/paperc.ts` define its contracts.

## Docs

- `docs/architecture/unified-mtg-companion-architecture.md` — product and target architecture
- `docs/privacy/data-flow.md` — documented data flow for offline, sync, and telemetry paths
- `docs/release/mancutg-arenac-mvp-checklist.md` — ArenaC MVP release checklist
