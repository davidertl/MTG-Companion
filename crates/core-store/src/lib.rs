use core_domain::{
    payload_value, CollectionSnapshot, DraftPick, EventType, ImportSourceKind, InventorySnapshot,
    LogSession, MatchRecord, NormalizedEvent, ParseReport, PlatformTag, RawChunk,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub struct EventStore {
    connection: Connection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LogCheckpointRecord {
    pub log_path: String,
    pub session_id: String,
    pub byte_offset: u64,
    pub source_fingerprint: String,
    pub pending_fragment: String,
    pub last_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IngestDiagnosticRecord {
    pub session_id: String,
    pub source_path: String,
    pub diagnostic_kind: String,
    pub message: String,
    pub detail_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PersistStats {
    pub inserted_raw_chunks: usize,
    pub inserted_events: usize,
}

impl EventStore {
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let connection = Connection::open_in_memory()?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    pub fn upsert_log_session(&self, session: &LogSession) -> rusqlite::Result<bool> {
        let changed = self.connection.execute(
            "INSERT OR IGNORE INTO log_sessions (session_id, platform_tag, source_kind, source_path)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session.session_id,
                session.platform_tag.label(),
                session.source_kind.label(),
                session.source_path,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn load_log_sessions(&self) -> rusqlite::Result<Vec<LogSession>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, platform_tag, source_kind, source_path
             FROM log_sessions
             ORDER BY rowid ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LogSession {
                session_id: row.get(0)?,
                platform_tag: PlatformTag::from_label(&row.get::<_, String>(1)?),
                source_kind: ImportSourceKind::from_label(&row.get::<_, String>(2)?),
                source_path: row.get(3)?,
            })
        })?;

        rows.collect()
    }

    pub fn count_raw_chunks(&self) -> rusqlite::Result<usize> {
        self.connection
            .query_row("SELECT COUNT(*) FROM raw_chunks", [], |row| row.get::<_, i64>(0))
            .map(|count| count as usize)
    }

    pub fn count_events(&self) -> rusqlite::Result<usize> {
        self.connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get::<_, i64>(0))
            .map(|count| count as usize)
    }

    pub fn load_raw_chunks_for_session(
        &self,
        session_id: &str,
    ) -> rusqlite::Result<Vec<RawChunk>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, chunk_offset, sha256, raw_text
             FROM raw_chunks
             WHERE session_id = ?1
             ORDER BY chunk_offset ASC",
        )?;
        let rows = statement.query_map(params![session_id], |row| {
            Ok(RawChunk {
                session_id: row.get(0)?,
                offset: row.get::<_, i64>(1)? as u64,
                sha256: row.get(2)?,
                raw_text: row.get(3)?,
            })
        })?;

        rows.collect()
    }

    pub fn load_log_checkpoint(
        &self,
        log_path: &str,
    ) -> rusqlite::Result<Option<LogCheckpointRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT log_path, session_id, byte_offset, source_fingerprint, pending_fragment, last_sequence
             FROM log_checkpoints
             WHERE log_path = ?1",
        )?;

        let mut rows = statement.query(params![log_path])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };

        Ok(Some(LogCheckpointRecord {
            log_path: row.get(0)?,
            session_id: row.get(1)?,
            byte_offset: row.get::<_, i64>(2)? as u64,
            source_fingerprint: row.get(3)?,
            pending_fragment: row.get(4)?,
            last_sequence: row.get::<_, i64>(5)? as u64,
        }))
    }

    pub fn upsert_log_checkpoint(
        &self,
        checkpoint: &LogCheckpointRecord,
    ) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO log_checkpoints (
                log_path,
                session_id,
                byte_offset,
                source_fingerprint,
                pending_fragment,
                last_sequence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(log_path) DO UPDATE SET
                session_id = excluded.session_id,
                byte_offset = excluded.byte_offset,
                source_fingerprint = excluded.source_fingerprint,
                pending_fragment = excluded.pending_fragment,
                last_sequence = excluded.last_sequence",
            params![
                checkpoint.log_path,
                checkpoint.session_id,
                checkpoint.byte_offset as i64,
                checkpoint.source_fingerprint,
                checkpoint.pending_fragment,
                checkpoint.last_sequence as i64,
            ],
        )?;
        Ok(())
    }

    pub fn load_all_log_checkpoints(&self) -> rusqlite::Result<Vec<LogCheckpointRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT log_path, session_id, byte_offset, source_fingerprint, pending_fragment, last_sequence
             FROM log_checkpoints
             ORDER BY log_path ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LogCheckpointRecord {
                log_path: row.get(0)?,
                session_id: row.get(1)?,
                byte_offset: row.get::<_, i64>(2)? as u64,
                source_fingerprint: row.get(3)?,
                pending_fragment: row.get(4)?,
                last_sequence: row.get::<_, i64>(5)? as u64,
            })
        })?;

        rows.collect()
    }

    pub fn append_ingest_diagnostics(
        &self,
        diagnostics: &[IngestDiagnosticRecord],
    ) -> rusqlite::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement = transaction.prepare(
                "INSERT INTO ingest_diagnostics (
                    session_id,
                    source_path,
                    diagnostic_kind,
                    message,
                    detail_json
                ) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for diagnostic in diagnostics {
                statement.execute(params![
                    diagnostic.session_id,
                    diagnostic.source_path,
                    diagnostic.diagnostic_kind,
                    diagnostic.message,
                    diagnostic.detail_json,
                ])?;
            }
        }
        transaction.commit()
    }

    pub fn load_ingest_diagnostics(&self) -> rusqlite::Result<Vec<IngestDiagnosticRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, source_path, diagnostic_kind, message, detail_json
             FROM ingest_diagnostics
             ORDER BY rowid ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(IngestDiagnosticRecord {
                session_id: row.get(0)?,
                source_path: row.get(1)?,
                diagnostic_kind: row.get(2)?,
                message: row.get(3)?,
                detail_json: row.get(4)?,
            })
        })?;

        rows.collect()
    }

    pub fn load_unknown_event_labels(&self) -> rusqlite::Result<Vec<String>> {
        let events = self.load_events()?;
        Ok(events
            .into_iter()
            .filter_map(|event| match event.event_type {
                EventType::Unknown(label) => Some(label),
                _ => None,
            })
            .collect())
    }

    pub fn apply_report(&self, report: &ParseReport) -> rusqlite::Result<PersistStats> {
        let transaction = self.connection.unchecked_transaction()?;
        let mut inserted_raw_chunks = 0;
        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO raw_chunks (session_id, chunk_offset, sha256, raw_text)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for chunk in &report.raw_chunks {
                inserted_raw_chunks += statement.execute(params![
                    chunk.session_id,
                    chunk.offset as i64,
                    chunk.sha256,
                    chunk.raw_text
                ])?;
            }
        }

        let mut inserted_events = 0;
        {
            let mut event_statement = transaction.prepare(
                "INSERT OR IGNORE INTO events (session_id, sequence, timestamp, event_type, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for event in &report.events {
                inserted_events += event_statement.execute(params![
                    event.session_id,
                    event.sequence as i64,
                    event.timestamp,
                    event.event_type.label(),
                    serde_json::to_string(&event.payload).expect("payload should serialize"),
                ])?;
            }
        }

        transaction.commit()?;
        Ok(PersistStats {
            inserted_raw_chunks,
            inserted_events,
        })
    }

    pub fn load_events(&self) -> rusqlite::Result<Vec<NormalizedEvent>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, sequence, timestamp, event_type, payload_json
             FROM events
             ORDER BY rowid ASC",
        )?;

        let rows = statement
            .query_map([], |row| {
                let payload_json: String = row.get(4)?;
                Ok(NormalizedEvent {
                    session_id: row.get(0)?,
                    sequence: row.get::<_, i64>(1)? as u64,
                    timestamp: row.get(2)?,
                    event_type: EventType::from_label(&row.get::<_, String>(3)?),
                    payload: parse_payload_json(&payload_json),
                })
            })?;

        rows.collect()
    }

    pub fn load_match_history(&self) -> rusqlite::Result<Vec<MatchRecord>> {
        let events = self.load_events()?;
        let mut matches: HashMap<String, (usize, MatchRecord)> = HashMap::new();

        for (index, event) in events.into_iter().enumerate() {
            let Some(match_id) = payload_value(&event.payload, "match_id") else {
                continue;
            };

            let entry = matches
                .entry(match_id.clone())
                .or_insert_with(|| {
                    (
                        index,
                        MatchRecord {
                            match_id: match_id.clone(),
                            deck: String::new(),
                            result: None,
                            queue: None,
                        },
                    )
                });

            if entry.1.deck.is_empty() {
                entry.1.deck = payload_value(&event.payload, "deck").unwrap_or_default();
            }

            if entry.1.queue.is_none() {
                entry.1.queue = payload_value(&event.payload, "queue");
            }

            if event.event_type == EventType::MatchEnd {
                entry.1.result = payload_value(&event.payload, "result");
            }
        }

        let mut ordered_matches = matches.into_values().collect::<Vec<_>>();
        ordered_matches.sort_by_key(|(first_seen_index, _)| *first_seen_index);

        Ok(ordered_matches
            .into_iter()
            .map(|(_, record)| record)
            .collect())
    }

    pub fn latest_collection_snapshot(&self) -> rusqlite::Result<Option<CollectionSnapshot>> {
        let events = self.load_events()?;
        Ok(events
            .into_iter()
            .rev()
            .find(|event| event.event_type == EventType::CollectionSnapshot)
            .map(|event| CollectionSnapshot {
                cards_owned: payload_value(&event.payload, "cards_owned")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                captured_at: event.timestamp,
            }))
    }

    pub fn latest_inventory_snapshot(&self) -> rusqlite::Result<Option<InventorySnapshot>> {
        let events = self.load_events()?;
        Ok(events
            .into_iter()
            .rev()
            .find(|event| event.event_type == EventType::InventorySnapshot)
            .map(|event| InventorySnapshot {
                gold: payload_value(&event.payload, "gold")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                gems: payload_value(&event.payload, "gems")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                wildcards: payload_value(&event.payload, "wildcards")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                vault: payload_value(&event.payload, "vault")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                captured_at: event.timestamp,
            }))
    }

    pub fn load_draft_picks(&self) -> rusqlite::Result<Vec<DraftPick>> {
        let events = self.load_events()?;
        Ok(events
            .into_iter()
            .filter(|event| event.event_type == EventType::DraftPick)
            .map(|event| DraftPick {
                set_code: payload_value(&event.payload, "set_code").unwrap_or_default(),
                pack_number: payload_value(&event.payload, "pack_number")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                pick_number: payload_value(&event.payload, "pick_number")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default(),
                choice: payload_value(&event.payload, "choice").unwrap_or_default(),
                recorded_at: event.timestamp,
            })
            .collect())
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        // Migrations run in order; each is idempotent (CREATE TABLE/INDEX IF NOT
        // EXISTS), so re-opening an existing store is safe. 002 adds the sync
        // outbox consumed by `core-sync` (W4.3).
        self.connection
            .execute_batch(include_str!("../migrations/001_init.sql"))?;
        self.connection
            .execute_batch(include_str!("../migrations/002_outbox.sql"))
    }
}

/// Migration-on-read for the `payload_json` column.
///
/// New rows store arbitrary structured JSON (`serde_json::Value`). Legacy rows
/// stored a flat JSON object of strings (the old `BTreeMap<String, String>`
/// payload) — that is valid JSON and loads through the same parse. Rows whose
/// payload is not valid JSON (never produced by this crate, but tolerated
/// defensively) are carried verbatim as a JSON string instead of failing the
/// whole load.
fn parse_payload_json(payload_json: &str) -> serde_json::Value {
    serde_json::from_str(payload_json)
        .unwrap_or_else(|_| serde_json::Value::String(payload_json.to_owned()))
}
