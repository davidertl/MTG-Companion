# Ingest Batches v1 Contract

Canonical contract for `POST /v1/ingest/batches` shared by ArenaC, PaperC, and Backend workstreams.

## Request Shape

```json
{
  "idempotencyKey": "producer-session-batch-key",
  "producer": {
    "app": "mancutg-arenac | mancutg-paperc | mancutg-backend",
    "version": "0.1.0",
    "instanceId": "producer-instance",
    "displayName": "optional human readable producer name"
  },
  "game": {
    "gameKey": "mtg-arena | mtg-paper | other-key",
    "gameFamily": "mtg",
    "title": "Magic: The Gathering Arena",
    "mode": "arena | paper | service"
  },
  "session": {
    "sourceSessionId": "producer-local-session-id",
    "startedAt": "ISO timestamp",
    "endedAt": "ISO timestamp optional",
    "source": "player-log | camera | manual-entry | other-source",
    "metadata": {}
  },
  "events": [
    {
      "eventId": "unique request entry id",
      "sourceEventId": "producer event id used for dedupe",
      "eventType": "domain.event.type",
      "occurredAt": "ISO timestamp",
      "seq": 1,
      "actor": {},
      "object": {},
      "targets": [],
      "payload": {},
      "confidence": 0.94,
      "provenance": {
        "source": "player.log | camera-frame | parser",
        "lineNumber": 1234,
        "frameNo": 1,
        "frameTimeMs": 64,
        "parserVersion": "arena-parser/0.1.0",
        "modelVersion": "paper-model/0.1.0",
        "artifactId": "optional-media-or-log-fragment-id",
        "metadata": {}
      }
    }
  ]
}
```

## Field Semantics

- `idempotencyKey`: required immutable batch identity. Retries must reuse the same key with byte-equivalent semantics.
- `sourceEventId`: producer-side stable event identity used for duplicate detection inside `(producer_id, session_id)`.
- `confidence`: optional normalized confidence in range `[0, 1]`; omit if unavailable.
- `provenance`: required event-level trace of origin (`source`) plus optional parser/camera/offset metadata.

## Response Shape

```json
{
  "batchId": "batch_01",
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0,
  "errors": [
    {
      "eventId": "paper-session-123-obs-3-0",
      "code": "invalid_payload",
      "message": "payload.zone is required"
    }
  ]
}
```

- `batchId`: backend batch identifier for accepted or replayed batches.
- `accepted`: count of newly stored valid events.
- `duplicates`: count of duplicate events (`sourceEventId` already seen for producer+session).
- `rejected`: count of invalid events rejected during validation.
- `errors[]`: per-event rejection details; valid events still commit in the same request.

## Idempotency State Matrix

1. Same `idempotencyKey` + same batch payload -> return original `batchId`, `accepted = 0`, `duplicates = 0`, `rejected = 0`.
2. Same `idempotencyKey` + different events/payload -> reject as immutable batch conflict.
3. New batch key + duplicate `sourceEventId` in existing `(producer, session)` -> increment `duplicates`, not an error.
4. New batch key + invalid events mixed with valid events -> accept valid entries, increment `rejected`, report each invalid entry in `errors[]`.

## Producer/Game/Session Upsert Semantics

- `producer` is upserted by producer identity (implementation-defined internal key).
- `game` is upserted by `game.gameKey`.
- `session` is upserted by unique tuple `(producer_id, source_session_id)`.
- Event write dedupe key is `(producer_id, session_id, sourceEventId)`.

## Canonical Fixtures

- Request (ArenaC): `services/api/tests/fixtures/ingest-batches/arenac-minimal.json`
- Request (PaperC): `services/api/tests/fixtures/ingest-batches/paperc-minimal.json`
- Response (partial error): `services/api/tests/fixtures/ingest-batches/partial-error.json`
