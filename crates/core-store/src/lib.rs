use core_domain::{
    payload_value, CollectionSnapshot, DraftPick, EventType, InventorySnapshot, MatchRecord,
    NormalizedEvent, ParseReport,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;

pub struct EventStore {
    connection: Connection,
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

    pub fn apply_report(&self, report: &ParseReport) -> rusqlite::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO raw_chunks (session_id, chunk_offset, sha256, raw_text)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for chunk in &report.raw_chunks {
                statement.execute(params![
                    chunk.session_id,
                    chunk.offset as i64,
                    chunk.sha256,
                    chunk.raw_text
                ])?;
            }
        }

        {
            let mut event_statement = transaction.prepare(
                "INSERT OR IGNORE INTO events (session_id, sequence, timestamp, event_type, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for event in &report.events {
                event_statement.execute(params![
                    event.session_id,
                    event.sequence as i64,
                    event.timestamp,
                    event.event_type.label(),
                    serde_json::to_string(&event.payload).expect("payload should serialize"),
                ])?;
            }
        }

        transaction.commit()
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
                    payload: serde_json::from_str(&payload_json).expect("payload should parse"),
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
        self.connection.execute_batch(include_str!("../migrations/001_init.sql"))
    }
}
