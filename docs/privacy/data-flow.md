# MancuTG-Companion privacy and data flow

## Local-first default

MancuTG-Companion is designed so that the default user journey does not require an
account or a running MancuTG-backend.

Local-only capabilities:

- read MTG Arena log files from disk
- import MTG Arena iOS/iPadOS log exports from `.log` files or folders
- normalize log lines into local events
- persist raw chunks and normalized events in the local store
- derive match history, collection snapshots, inventory snapshots, and draft picks
- reconstruct per-turn game timelines from parsed gameplay events (`core-gamestate`)
- run local analysis (`core-analysis`) producing findings/suggestions
- export local history as JSON or CSV
- keep imported Archidekt deck snapshots cached locally after import

## Card database import (local, offline)

Card knowledge for analysis comes from the Scryfall "Oracle Cards" bulk data file.

- the user **downloads the bulk file manually** from Scryfall; the app performs
  **no runtime network calls** to fetch it
- `import-card-db` streams that file into a local `cards.sqlite` beside the event
  store; re-import is idempotent
- lookups (by `arena_id` and by card name) and all analysis run **fully offline**
  once imported
- the card database is never uploaded to the backend

## Analysis findings (local events)

The analysis engine is **human-in-the-loop** and never issues autonomous rulings.

- findings and suggestions are appended to the local event stream as
  `analysis.finding.raised` / `analysis.suggestion.raised` events, reusing the
  existing append-only store and review machinery
- each finding carries a severity, confidence, Comprehensive Rules references,
  and an `audience` (`players` | `referee-only` | `all`)
- by default findings stay local; they leave the device only through the same
  consent-gated sync path as any other event (below)

## Optional outbound network paths

Outbound traffic is intentionally small and purpose-gated.

| Purpose | Default | Trigger |
|---|---|---|
| `updates` | allowed | checking for app updates or release metadata |
| `sync` | disabled | user explicitly enables account-backed sync |
| `telemetry` | disabled | user explicitly opts in to telemetry |
| `archidekt` | disabled | user explicitly enables sync/integration features |
| `rawUpload` | disabled | user explicitly opts in to uploading raw log chunks |

## Sync outbox (consent-gated)

Local events reach the backend only through a **consent-gated outbox**, never
automatically.

- events are enqueued in a local `sync_outbox` table on ingest; nothing is sent
  while sync consent is off — the hard gate makes **zero** network requests and
  the outbox simply accumulates
- when sync consent is on, `sync-now` drains the outbox to `POST /events` in
  batches, each with a deterministic `idempotencyKey` (a retried batch cannot
  create duplicate server rows)
- **only normalized events** are synced; **raw log chunks are never uploaded**
  unless the separate `rawUpload` consent is explicitly enabled
- `GET /events?cursor=<n>` provides cursor-based pull for tournament-scoped reads

## Referee-only findings (required disclosure)

When a game is bound to a tournament, analysis findings can sync to the backend
(via the same consent-gated event path). Who may read them is enforced
**server-side**, not merely hidden in the client:

- a tournament has a `findingVisibilityMode` (`players` | `referee-only`); each
  finding also carries an `audience`
- **referee and organizer** roles see all findings for their tournament
- in `referee-only` mode, **players and spectators receive nothing** — the
  `GET /tournaments/:id/findings` response omits the findings entirely
  (returns `200` with them absent, so their existence does not leak; never a
  `403`)
- a `referee-only`-audience finding is never routed outside the referee tier,
  regardless of mode; default-deny is the resolution rule
- the PaperC player client additionally suppresses findings locally in
  `referee-only` mode and shows an "analysis routed to referee" notice, but the
  authoritative enforcement point is the backend visibility matrix
- reviews (`analysis.finding.reviewed`) are performed by referees/organizers

## MancuTG-backend boundary

MancuTG-backend is additive only. It may receive:

- sync objects produced from local entities
- shared backend event batches produced by MancuTG-ArenaC, MancuTG-PaperC, or MancuTG-backend
- separate PaperC media session/artefact batches via `/media/sessions`
- validated Archidekt import payloads
- opt-in telemetry events

Current shared event ingest structure:

- optional `idempotencyKey`
- `sessions[]`
- `events[]`

Shared event/session core fields currently modeled:

- `sourceSessionId`
- `sourceApp` (`mancutg-arenac`, `mancutg-paperc`, or `mancutg-backend`)
- `sourceKind`
- `eventId`
- `eventType`
- `occurredAt`
- optional `matchId`, `gameId`, `streamId`, `actor`, `object`, `objects`, `targets`
- `provenance[]`
- `confidence`
- `reviewStatus`

PaperC-specific shared contracts now live in:

- `packages/shared-schema/src/paperc.ts`
- `packages/shared-schema/src/tournaments.ts`
- `packages/shared-schema/src/media.ts`

Runtime persistence for session/event/media metadata is selected by store path:

- override: `MANCUTG_BACKEND_STORE_PATH`
- `.json` paths (incl. the unset default `./mancutg-backend-store.json`) use the
  legacy JSON file store (compatibility)
- any other path opens a `node:sqlite` database (append-only events, cursor pull)

### Shared batch envelope

Cross-client event ingestion now uses one batch structure regardless of producer:

- optional `idempotencyKey`
- `sessions[]`
- `events[]`

This keeps MancuTG-backend ingestion uniform even when ArenaC, PaperC, and
backend-produced review/correction flows emit different domain-specific details.

MancuTG-backend must not be required for:

- local log parsing
- iOS/iPadOS offline log import
- local persistence
- match history browsing
- collection/economy snapshots
- exports

## Archidekt connector

Archidekt imports are treated as a read-only integration:

- a Python connector uses `pyrchidekt` when available
- the connector normalizes remote deck data into the shared schema
- the desktop caches validated snapshots locally
- already imported deck snapshots remain available offline

## Explicit non-goals

- no memory reading
- no packet interception
- no DLL injection
- no live iPad/iPhone tracking
- no jailbreak-only access path
- no direct cross-app sandbox access on iOS/iPadOS
- no required telemetry
- no mandatory account for local MancuTG-ArenaC workflows
