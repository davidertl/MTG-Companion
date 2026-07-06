-- Outbox for optional, consent-gated backend sync (W4.3).
--
-- Rows are *normalized events* pending upload to the backend `/events`
-- endpoint. Raw log chunks are intentionally NEVER placed here: this unit only
-- syncs normalized/analysis events, satisfying the "events/normalized only"
-- (rawUploadEnabled defaults off) invariant by construction.
--
-- `event_id` is the stable idempotency identity ("<session_id>:<sequence>"),
-- so enqueue is idempotent via INSERT OR IGNORE and the backend deduplicates
-- on (sourceApp, sourceSessionId, eventId). `synced_at` NULL means pending;
-- once the backend acks a batch the row is stamped and never re-sent.
--
-- This DDL is the single source of truth for the outbox schema. `core-store`
-- runs it as migration 002; `core-sync` (crates/core-sync/src/outbox.rs)
-- include_str!()s this same file so both crates agree byte-for-byte.
CREATE TABLE IF NOT EXISTS sync_outbox (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
  ON sync_outbox (synced_at)
  WHERE synced_at IS NULL;
