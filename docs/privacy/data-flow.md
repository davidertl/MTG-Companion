# Privacy and data flow

## Local-first default

The companion is designed so that the default user journey does not require an account
or a running backend.

Local-only capabilities:

- read MTG Arena log files from disk
- normalize log lines into local events
- persist raw chunks and normalized events in the local store
- derive match history, collection snapshots, inventory snapshots, and draft picks
- export local history as JSON or CSV
- keep imported Archidekt deck snapshots cached locally after import

## Optional outbound network paths

Outbound traffic is intentionally small and purpose-gated.

| Purpose | Default | Trigger |
|---|---|---|
| `updates` | allowed | checking for app updates or release metadata |
| `sync` | disabled | user explicitly enables account-backed sync |
| `telemetry` | disabled | user explicitly opts in to telemetry |
| `archidekt` | disabled | user explicitly enables sync/integration features |

## Backend boundary

The backend is additive only. It may receive:

- sync objects produced from local entities
- validated Archidekt import payloads
- opt-in telemetry events

The backend must not be required for:

- local log parsing
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
- no required telemetry
- no mandatory account for local companion workflows
