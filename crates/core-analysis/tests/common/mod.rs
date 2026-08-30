//! Shared fixture helpers for the `core-analysis` check specs.
//!
//! Fixtures are built the same way the Arena parser and the PaperC logger emit:
//! `NormalizedEvent`s carrying a serialized `GameAction` under the payload
//! `"action"` key, optionally with raw identifiers (`instanceId`) alongside.
//! Card knowledge is an in-memory `CardDb` imported from a tiny synthetic
//! Scryfall-shaped JSON array.
#![allow(dead_code)]

use core_carddb::CardDb;
use core_domain::{CardRef, EventType, GameAction, NormalizedEvent};
use serde_json::{json, Value};

/// Build a normalized gameplay event carrying a serialized action plus any
/// extra raw payload fields (e.g. `instanceId`).
pub fn event(sequence: u64, event_type: EventType, action: GameAction, extra: Value) -> NormalizedEvent {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "action".to_owned(),
        serde_json::to_value(&action).expect("action serializes"),
    );
    if let Value::Object(map) = extra {
        for (key, value) in map {
            payload.insert(key, value);
        }
    }
    NormalizedEvent {
        session_id: "session-1".to_owned(),
        sequence,
        timestamp: format!("2026-07-06T00:00:{sequence:02}Z"),
        event_type,
        payload: Value::Object(payload),
    }
}

/// A paper-sourced card reference (name only).
pub fn paper_card(name: &str) -> CardRef {
    CardRef {
        name: Some(name.to_owned()),
        ..CardRef::default()
    }
}

/// An Arena-sourced card reference (arena id only).
pub fn arena_card(arena_id: u64) -> CardRef {
    CardRef {
        arena_id: Some(arena_id),
        ..CardRef::default()
    }
}

/// A synthetic Scryfall-shaped card object for the in-memory card DB.
pub fn card_json(
    id: &str,
    name: &str,
    type_line: &str,
    oracle_text: &str,
    cmc: f64,
    keywords: &[&str],
    arena_id: Option<u64>,
) -> Value {
    json!({
        "id": id,
        "name": name,
        "type_line": type_line,
        "oracle_text": oracle_text,
        "cmc": cmc,
        "keywords": keywords,
        "arena_id": arena_id,
    })
}

/// Build an in-memory card DB from synthetic card objects.
pub fn carddb(cards: &[Value]) -> CardDb {
    let db = CardDb::open_in_memory().expect("open in-memory card db");
    let bytes = serde_json::to_vec(&Value::Array(cards.to_vec())).expect("serialize cards");
    db.import_scryfall_bulk(bytes.as_slice()).expect("import cards");
    db
}

/// Count findings carrying a given code.
pub fn count_code(findings: &[core_analysis::Finding], code: &str) -> usize {
    findings.iter().filter(|finding| finding.code == code).count()
}
