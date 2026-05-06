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

## MancuTG-backend boundary

MancuTG-backend is additive only. It may receive:

- sync objects produced from local entities
- validated Archidekt import payloads
- opt-in telemetry events

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
