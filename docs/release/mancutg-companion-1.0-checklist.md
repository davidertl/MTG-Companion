# MancuTG-Companion 1.0 release checklist

This checklist supersedes `mancutg-arenac-mvp-checklist.md` (which is kept as the
historical MVP record). It is written to be executed **top to bottom by a human**
verifying the full 1.0 product: the Arena flow, the paper flow, analysis, the
referee-only tournament mode, card-database import, and consent-gated sync.

Unless noted otherwise, run every command from the repository root. Paths below
are always absolute-from-repo-root or literal CLI arguments you substitute.

> Product invariant reminder for the person running this list: the analysis
> engine is **human-in-the-loop**. It never issues autonomous rulings. Findings
> are hints carrying severity, confidence, and Comprehensive Rules references,
> routed to a human — the player by default, and **only the referee** in
> referee-only tournament mode (enforced server-side).

---

## 0. Full verification gate

- [ ] `npm ci`
- [ ] `npm run verify:all`
      (runs `npm test` = typecheck + vitest + cargo + python, then
      `api:smoke`, `arenac:build`, `arenac:smoke`, `paperc:build`)
- [ ] `bash scripts/e2e_arena_flow.sh` *(added by W5.2)* — synthetic detailed
      log → ingest → `inspect-store` shows play-level events → analysis findings
- [ ] `bash scripts/e2e_paper_referee_flow.sh` *(added by W5.2)* — referee sees a
      seeded finding, the player does not (release-blocking visibility assertion)

`npm run verify:all` is the same chain every integration gate and CI run uses
(`scripts/verify_all.sh`).

---

## 1. Arena flow: detailed logs → live watch → play-level events → analyze

Enable **Detailed Logs (Plugin Support)** in MTG Arena (Options → Account) so
`Player.log` contains `GreToClientEvent` gameplay messages.

- [ ] `mancutg-arenac --help` lists `bootstrap`, `watch-log`, `sync-now`,
      `inspect-store`, `reprocess-session`, `export-backup`, `import-ios-file`,
      `import-ios-folder`, `import-card-db`, `card-db-status`, and the
      settings/consent commands
- [ ] One-shot ingest of an existing log:
      `cargo run -p mancutg-arenac -- bootstrap "/path/to/Player.log"`
- [ ] Continuous live watch (tails the log, ingests appends without duplicates):
      `cargo run -p mancutg-arenac -- watch-log "/path/to/Player.log" "/path/to/store.sqlite3" --follow`
      - [ ] appends made while following are ingested; a restart reuses the
            checkpoint and does not re-ingest
      - [ ] `--follow` stops cleanly on Ctrl-C; a missing file waits without
            crashing
- [ ] Play-level events are present, not just match metadata:
      `cargo run -p mancutg-arenac -- inspect-store "/path/to/store.sqlite3"`
      shows gameplay event types (e.g. `CardCast`, `LandPlayed`, `ZoneTransfer`,
      `TurnBegin`, `PhaseChange`, `AttackersDeclared`, `LifeChanged`), with
      unrecognized fragments funnelled to `Unknown` + ingest diagnostics
- [ ] In the desktop app (or via the read model), a match opens to a **per-turn
      timeline** reconstructed by `core-gamestate`; hidden information is honest
      (opponent hand/library are counts only)
- [ ] **Run analysis** on a match (desktop "Run analysis" action → `analyze_match`
      Tauri command; the `scripts/e2e_arena_flow.sh` path exercises the same
      engine). Findings/suggestions render with `ruleRefs`, `confidence`, and
      severity ≤ `possible-violation`, using non-overclaiming language
      ("possible", never "cheated")
- [ ] With **no card DB imported**, analysis surfaces guidance to run
      `import-card-db` rather than failing

---

## 2. Card DB import (offline, manual download)

- [ ] Download the Scryfall **"Oracle Cards"** bulk data file manually from
      <https://scryfall.com/docs/api/bulk-data> (the CLI help documents this URL)
- [ ] `cargo run -p mancutg-arenac -- import-card-db "/path/to/oracle-cards.json"`
      imports into `cards.sqlite` beside the event store; the import performs
      **no network calls** (offline-first) and is idempotent on re-import
- [ ] `cargo run -p mancutg-arenac -- card-db-status` reports the row count and
      DB path
- [ ] Lookups resolve by `arena_id` and by exact/case-insensitive card name;
      analysis that needs card knowledge (types, keywords, oracle text) now fires

---

## 3. Paper flow: log a game in PaperC → events

- [ ] `npm run paperc:dev` starts the PaperC browser PWA (Vite dev server)
- [ ] Game setup captures players, format, and optional `tournamentContext`
- [ ] The turn/phase stepper + action palette log moves move-by-move (play land /
      cast spell / attack / block / life change / trigger noted / note); card
      names autocomplete against a **build-time** bundled index (no runtime
      network)
- [ ] Each logged move becomes a `paperc.observation.detected` event with a typed
      `gameActions` payload, `provenance: 'manual'`, `confidence: 1`, in the
      **same shared envelope** as Arena events
- [ ] Undo emits an `undoApplied` **correction** (append-only) — it never deletes
      a prior event; the projected log hides the undone action
- [ ] The same `core-gamestate` reconstruction and `core-analysis` engine consume
      the paper event stream and produce equivalent timelines/findings

---

## 4. Referee-only tournament mode (server-side enforced)

Start the backend with a temporary SQLite store and registration enabled:
`MANCUTG_ALLOW_REGISTRATION=1 MANCUTG_BACKEND_STORE_PATH=/tmp/mancutg-1.0.sqlite npm run api:start`
(`scripts/e2e_paper_referee_flow.sh` automates this whole section.)

- [ ] `POST /auth/register` mints bearer tokens for an **organizer**, a
      **referee**, and a **player**
- [ ] `POST /tournaments` (organizer) creates a tournament with
      `findingVisibilityMode: 'referee-only'`; the creator becomes organizer
- [ ] `POST /tournaments/:id/members` adds the referee and player with roles;
      a non-organizer cannot add members (403); a tournament route without a
      token is 401
- [ ] `GET /tournaments/:id/role` returns the caller's role
- [ ] A scripted paper game with a **seeded violation** is posted via `POST /events`
      (analysis findings arrive as `analysis.finding.raised` events)
- [ ] `GET /tournaments/:id/findings` as the **referee/organizer** returns the
      referee-only finding
- [ ] `GET /tournaments/:id/findings` as the **player** returns `200` with the
      finding **absent** (presence must not leak — never a 403); a spectator sees
      nothing in referee-only mode
- [ ] `POST /tournaments/:id/findings/:findingId/review` (referee) emits
      `analysis.finding.reviewed` and is idempotent
- [ ] In the PaperC player client, a game bound to a `referee-only` tournament
      shows a persistent "analysis routed to referee" notice and renders **zero**
      findings locally, even if finding events exist in local data

---

## 5. Sync (`sync-now`, consent-gated)

- [ ] With sync consent **off** (default),
      `cargo run -p mancutg-arenac -- sync-now "/path/to/store.sqlite3"` makes
      **zero** network requests — the outbox accumulates, the hard gate holds
- [ ] Enable sync consent:
      `cargo run -p mancutg-arenac -- set-consent sync on`
- [ ] `cargo run -p mancutg-arenac -- sync-now "/path/to/store.sqlite3"` drains
      the outbox to the backend `POST /events` in batches with a per-batch
      `idempotencyKey`; a retried batch does not create duplicate server rows
- [ ] Raw log chunks are **never** uploaded unless `rawUploadEnabled` is on;
      by default only normalized events sync
- [ ] Backend restart preserves synced rows (SQLite persistence); `GET /events?cursor=`
      pulls tournament-scoped events with stable, gap-free pagination

---

## 6. Packaging and hosting

- [ ] Desktop bundle config (`apps/desktop/src-tauri/tauri.conf.json`) is coherent:
      `beforeDevCommand`/`beforeBuildCommand` map to the desktop app's vite
      `dev`/`build`, `frontendDist` is `../dist` (matching vite `outDir`), and the
      registered Tauri commands (watcher, consent, analyze, card DB, sync) resolve.
      A real GUI bundle (`npm run arenac:bundle`) requires GTK/WebKit toolchain on
      the build host and is out of scope for CI here.
- [ ] **PaperC static hosting:** `npm run paperc:build` emits a self-contained
      static bundle to `apps/paperc/dist/`. Serve that directory from any static
      host (or `npx serve apps/paperc/dist`) — the client is offline-capable and
      needs the backend only for optional sync / referee feeds.

---

## 7. User-facing documentation

- [ ] `README.md` "Implementierter Stand" reflects the shipped components
      (`core-carddb`, `core-gamestate`, `core-analysis`, the PaperC move-logging
      app, backend auth/roles, referee-only findings visibility, the sync outbox)
- [ ] `CLAUDE.md` Architecture/Commands/Key-invariants are current
- [ ] `docs/privacy/data-flow.md` documents the card-DB import path, analysis
      findings as local events, the consent-gated sync outbox, and the
      referee-only findings disclosure

---

## Known limitations before broad release

- MTGA GRE parser coverage is a high-value subset, not the entire gameplay
  protocol; unrecognized fragments degrade to `Unknown` + diagnostics (the
  early-warning funnel for Arena format drift).
- Rules coverage is deliberately **high-precision / low-recall**: findings say
  "possible rule-break"; the referee review step is the authority.
- No overlay/HUD, no web profiles/sharing, no bidirectional Archidekt.
- No packaged GUI installer is produced in CI (GTK/WebKit toolchain dependency).
- Whether referees may consult such a tool in sanctioned play is a
  tournament-policy question outside the software; referee-only mode exists so
  the tool *can* be used compliantly.
