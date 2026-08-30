//! Consent-gated sync outbox: enqueue local events, drain them to the backend
//! `/events` endpoint in batches, and mark them acked.
//!
//! The transport is injected (a closure or any [`BatchTransport`]) so the drain
//! logic is unit-testable against a mock server without a real socket. Backoff
//! is exponential; each batch carries one deterministic `idempotencyKey`
//! (derived from its exact event set) so a retried batch cannot create
//! duplicate rows server-side.
//!
//! The outbox table (`sync_outbox`) is defined once in
//! `crates/core-store/migrations/002_outbox.sql`; that same file is
//! `include_str!`d here so `core-sync` and `core-store` never drift.

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;
use std::thread;
use std::time::Duration;

/// Canonical outbox DDL, shared verbatim with `core-store` migration 002.
/// It is idempotent (`CREATE ... IF NOT EXISTS`), so running it after
/// `core-store` has already migrated the DB is a no-op.
pub const OUTBOX_SCHEMA: &str = include_str!("../../core-store/migrations/002_outbox.sql");

/// Placeholder timestamp for events whose `occurred_at` is empty (e.g. locally
/// synthesized analysis findings). The backend `occurredAt` field requires a
/// non-empty string, so we never send `""`.
const EPOCH_PLACEHOLDER: &str = "1970-01-01T00:00:00Z";

/// An event to enqueue for sync. Mirrors the persisted event shape closely
/// enough to rebuild a backend envelope, without pulling in `core-store`.
#[derive(Debug, Clone)]
pub struct OutboxEventInput {
    pub session_id: String,
    pub sequence: u64,
    /// The stored event-type label (e.g. `MATCH_START`, `CARD_CAST`).
    pub event_type: String,
    pub occurred_at: String,
    pub payload: Value,
}

impl OutboxEventInput {
    /// Stable idempotency identity for an event: `"<session_id>:<sequence>"`.
    pub fn event_id(&self) -> String {
        format!("{}:{}", self.session_id, self.sequence)
    }
}

/// A pending (or acked) outbox row.
#[derive(Debug, Clone)]
pub struct OutboxRow {
    pub event_id: String,
    pub session_id: String,
    pub sequence: u64,
    pub event_type: String,
    pub occurred_at: String,
    pub payload: Value,
    pub synced_at: Option<String>,
    pub attempt_count: u32,
}

/// Provenance defaults describing where synced events came from. Mirrors the
/// shared `backendEventSessionSchema` / `backendEventProvenanceSchema` required
/// fields so the emitted batch validates against `packages/shared-schema`.
#[derive(Debug, Clone)]
pub struct BatchContext {
    pub source_app: String,
    pub source_kind: String,
    pub platform: String,
    pub game_mode: String,
    pub started_at: String,
}

impl Default for BatchContext {
    fn default() -> Self {
        Self {
            source_app: "mancutg-arenac".to_owned(),
            source_kind: "arena-log".to_owned(),
            platform: "desktop".to_owned(),
            game_mode: "arena".to_owned(),
            started_at: EPOCH_PLACEHOLDER.to_owned(),
        }
    }
}

/// Session envelope — the minimal required subset of `backendEventSessionSchema`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSessionEnvelope {
    pub source_session_id: String,
    pub source_app: String,
    pub source_kind: String,
    pub platform: String,
    pub game_mode: String,
    pub started_at: String,
}

/// Provenance entry — required (min 1) on every backend event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProvenance {
    pub source_kind: String,
    pub source_session_id: String,
}

/// Event envelope — the minimal required subset of `backendEventEnvelopeSchema`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEventEnvelope {
    pub event_id: String,
    pub source_app: String,
    pub source_session_id: String,
    pub event_type: String,
    pub occurred_at: String,
    pub provenance: Vec<SyncProvenance>,
    pub payload: Value,
}

/// The `/events` batch envelope: `{ idempotencyKey, sessions[], events[] }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBatch {
    pub idempotency_key: String,
    pub sessions: Vec<SyncSessionEnvelope>,
    pub events: Vec<SyncEventEnvelope>,
}

/// Outcome of a single transport attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportOutcome {
    /// 2xx — the backend accepted (or idempotently deduplicated) the batch.
    Success,
    /// 5xx / network error — retry with backoff.
    Retryable(String),
    /// 4xx — the batch is malformed; do not retry it.
    Permanent(String),
}

/// Anything that can send a serialized batch. Blanket-implemented for
/// `FnMut(&SyncBatch, &str) -> TransportOutcome`, so tests pass a closure.
pub trait BatchTransport {
    fn send(&mut self, batch: &SyncBatch, body: &str) -> TransportOutcome;
}

impl<F> BatchTransport for F
where
    F: FnMut(&SyncBatch, &str) -> TransportOutcome,
{
    fn send(&mut self, batch: &SyncBatch, body: &str) -> TransportOutcome {
        self(batch, body)
    }
}

/// Drain tuning.
#[derive(Debug, Clone)]
pub struct DrainConfig {
    /// Max events per POST.
    pub batch_size: usize,
    /// Total attempts per batch (1 initial + retries).
    pub max_attempts: u32,
    /// Base delay for exponential backoff; `Duration::ZERO` disables sleeping
    /// (used by tests).
    pub base_backoff: Duration,
    pub context: BatchContext,
}

impl Default for DrainConfig {
    fn default() -> Self {
        Self {
            batch_size: 100,
            max_attempts: 4,
            base_backoff: Duration::from_millis(500),
            context: BatchContext::default(),
        }
    }
}

/// Result of a drain / sync pass.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DrainReport {
    /// False when sync was disabled — the hard consent gate never attempts I/O.
    pub attempted: bool,
    pub batches_sent: usize,
    pub events_synced: usize,
    /// Total transport invocations (including retries) — asserted as 0 by the
    /// consent-off test.
    pub transport_calls: usize,
    /// Events left pending after this pass (transient failures).
    pub failed_events: usize,
    pub last_error: Option<String>,
}

/// Exponential backoff delay for the given zero-based retry index.
/// `attempt = 0` is the first retry (`base`), `1` is `2*base`, etc.
pub fn backoff_delay(base: Duration, attempt: u32) -> Duration {
    base.saturating_mul(1u32 << attempt.min(16))
}

/// Deterministic FNV-1a-64 hex digest — stable across processes/platforms, so a
/// retried batch computes the identical `idempotencyKey`.
fn fnv1a_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The consent-gated sync outbox, owning its own connection to the store DB.
pub struct Outbox {
    connection: Connection,
}

impl Outbox {
    /// Opens (or creates) the outbox in the given SQLite file, ensuring the
    /// schema exists. Safe to call after `core-store` has already migrated.
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        let outbox = Self { connection };
        outbox.ensure_schema()?;
        Ok(outbox)
    }

    /// In-memory outbox for tests.
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let connection = Connection::open_in_memory()?;
        let outbox = Self { connection };
        outbox.ensure_schema()?;
        Ok(outbox)
    }

    fn ensure_schema(&self) -> rusqlite::Result<()> {
        self.connection.execute_batch(OUTBOX_SCHEMA)
    }

    /// Enqueues events for sync. Idempotent: rows already present (by
    /// `event_id`) are ignored, so re-mirroring the store is a no-op. Returns
    /// the number of newly inserted rows.
    pub fn enqueue(&self, events: &[OutboxEventInput]) -> rusqlite::Result<usize> {
        let transaction = self.connection.unchecked_transaction()?;
        let mut inserted = 0usize;
        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO sync_outbox
                    (event_id, session_id, sequence, event_type, occurred_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for event in events {
                inserted += statement.execute(params![
                    event.event_id(),
                    event.session_id,
                    event.sequence as i64,
                    event.event_type,
                    event.occurred_at,
                    serde_json::to_string(&event.payload).unwrap_or_else(|_| "{}".to_owned()),
                ])?;
            }
        }
        transaction.commit()?;
        Ok(inserted)
    }

    pub fn pending_count(&self) -> rusqlite::Result<usize> {
        self.connection
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
    }

    pub fn synced_count(&self) -> rusqlite::Result<usize> {
        self.connection
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NOT NULL",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
    }

    /// Returns pending rows in enqueue order.
    pub fn pending(&self) -> rusqlite::Result<Vec<OutboxRow>> {
        let mut statement = self.connection.prepare(
            "SELECT event_id, session_id, sequence, event_type, occurred_at, payload_json,
                    synced_at, attempt_count
             FROM sync_outbox
             WHERE synced_at IS NULL
             ORDER BY rowid ASC",
        )?;
        let rows = statement.query_map([], |row| {
            let payload_json: String = row.get(5)?;
            Ok(OutboxRow {
                event_id: row.get(0)?,
                session_id: row.get(1)?,
                sequence: row.get::<_, i64>(2)? as u64,
                event_type: row.get(3)?,
                occurred_at: row.get(4)?,
                payload: serde_json::from_str(&payload_json)
                    .unwrap_or(Value::Object(Default::default())),
                synced_at: row.get(6)?,
                attempt_count: row.get::<_, i64>(7)? as u32,
            })
        })?;
        rows.collect()
    }

    fn mark_synced(&self, event_ids: &[String], synced_at: &str) -> rusqlite::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement = transaction.prepare(
                "UPDATE sync_outbox SET synced_at = ?2, last_error = NULL WHERE event_id = ?1",
            )?;
            for event_id in event_ids {
                statement.execute(params![event_id, synced_at])?;
            }
        }
        transaction.commit()
    }

    fn record_attempt(&self, event_ids: &[String], error: &str) -> rusqlite::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement = transaction.prepare(
                "UPDATE sync_outbox
                    SET attempt_count = attempt_count + 1, last_error = ?2
                  WHERE event_id = ?1",
            )?;
            for event_id in event_ids {
                statement.execute(params![event_id, error])?;
            }
        }
        transaction.commit()
    }

    /// Builds the batch envelope for a slice of pending rows: one synthesized
    /// session per distinct `session_id` (so the backend accepts the events),
    /// plus a deterministic `idempotencyKey`.
    fn build_batch(&self, rows: &[OutboxRow], context: &BatchContext) -> SyncBatch {
        let mut session_ids: BTreeSet<String> = BTreeSet::new();
        for row in rows {
            session_ids.insert(row.session_id.clone());
        }

        let sessions = session_ids
            .iter()
            .map(|session_id| SyncSessionEnvelope {
                source_session_id: session_id.clone(),
                source_app: context.source_app.clone(),
                source_kind: context.source_kind.clone(),
                platform: context.platform.clone(),
                game_mode: context.game_mode.clone(),
                started_at: context.started_at.clone(),
            })
            .collect();

        let events = rows
            .iter()
            .map(|row| {
                let occurred_at = if row.occurred_at.trim().is_empty() {
                    EPOCH_PLACEHOLDER.to_owned()
                } else {
                    row.occurred_at.clone()
                };
                SyncEventEnvelope {
                    event_id: row.event_id.clone(),
                    source_app: context.source_app.clone(),
                    source_session_id: row.session_id.clone(),
                    event_type: row.event_type.clone(),
                    occurred_at,
                    provenance: vec![SyncProvenance {
                        source_kind: context.source_kind.clone(),
                        source_session_id: row.session_id.clone(),
                    }],
                    payload: normalize_payload(&row.payload),
                }
            })
            .collect::<Vec<_>>();

        let joined_ids = rows
            .iter()
            .map(|row| row.event_id.as_str())
            .collect::<Vec<_>>()
            .join("|");
        let idempotency_key = format!("arenac-{}", fnv1a_hex(&joined_ids));

        SyncBatch {
            idempotency_key,
            sessions,
            events,
        }
    }

    /// Drains all pending rows through `transport`, chunked into batches, with
    /// exponential backoff on retryable failures. Successfully-acked rows are
    /// stamped `synced_at`; transiently-failed rows stay pending for a later
    /// drain. This function makes network attempts unconditionally — use
    /// [`sync_outbox`] to hard-gate on consent.
    pub fn drain<T: BatchTransport>(
        &self,
        mut transport: T,
        config: &DrainConfig,
    ) -> rusqlite::Result<DrainReport> {
        let pending = self.pending()?;
        let mut report = DrainReport {
            attempted: true,
            ..DrainReport::default()
        };
        if pending.is_empty() {
            return Ok(report);
        }

        let batch_size = config.batch_size.max(1);
        for chunk in pending.chunks(batch_size) {
            let batch = self.build_batch(chunk, &config.context);
            let body = serde_json::to_string(&batch).unwrap_or_else(|_| "{}".to_owned());
            let event_ids: Vec<String> =
                chunk.iter().map(|row| row.event_id.clone()).collect();

            let mut attempt = 0u32;
            loop {
                report.transport_calls += 1;
                match transport.send(&batch, &body) {
                    TransportOutcome::Success => {
                        self.mark_synced(&event_ids, &now_iso8601())?;
                        report.batches_sent += 1;
                        report.events_synced += chunk.len();
                        break;
                    }
                    TransportOutcome::Permanent(error) => {
                        self.record_attempt(&event_ids, &error)?;
                        report.failed_events += chunk.len();
                        report.last_error = Some(error);
                        break;
                    }
                    TransportOutcome::Retryable(error) => {
                        self.record_attempt(&event_ids, &error)?;
                        attempt += 1;
                        if attempt >= config.max_attempts {
                            report.failed_events += chunk.len();
                            report.last_error = Some(error);
                            break;
                        }
                        let delay = backoff_delay(config.base_backoff, attempt - 1);
                        if !delay.is_zero() {
                            thread::sleep(delay);
                        }
                    }
                }
            }
        }

        Ok(report)
    }
}

/// Backend `payload` must be a JSON object (`z.record(...)`). Non-object
/// payloads are wrapped so the batch still validates.
fn normalize_payload(payload: &Value) -> Value {
    if payload.is_object() {
        payload.clone()
    } else {
        serde_json::json!({ "value": payload })
    }
}

fn now_iso8601() -> String {
    // A monotonic-enough marker; the exact value is not load-bearing (the row
    // is simply "acked"). Kept dependency-free.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("synced@{secs}")
}

/// Consent hard gate. When `sync_enabled` is false this returns immediately
/// with `attempted: false` and **zero** transport calls — the outbox keeps
/// accumulating but nothing leaves the device.
pub fn sync_outbox<T: BatchTransport>(
    outbox: &Outbox,
    sync_enabled: bool,
    transport: T,
    config: &DrainConfig,
) -> rusqlite::Result<DrainReport> {
    if !sync_enabled {
        return Ok(DrainReport::default());
    }
    outbox.drain(transport, config)
}
