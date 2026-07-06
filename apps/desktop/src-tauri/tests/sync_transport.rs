//! W4.3 desktop sync transport: consent hard-gate and enqueue-on-ingest.
//!
//! These tests exercise the *gate* and the *outbox mirror* without a running
//! backend. The transport/backoff/idempotency behavior itself is covered by
//! `core-sync`'s `outbox_transport.rs`; here we prove the desktop wiring never
//! makes a network call when sync consent is off.

use core_domain::{EventType, NormalizedEvent, ParseReport};
use core_store::EventStore;
use mancutg_arenac::{enqueue_ingested_events, set_consent, sync_now};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_path(name: &str, extension: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mancutg-arenac-{name}-{timestamp}.{extension}"))
}

fn seed_events(store_path: &std::path::Path, count: u64) {
    let store = EventStore::open(store_path).expect("store opens");
    let events = (0..count)
        .map(|sequence| NormalizedEvent {
            session_id: "session-x".to_owned(),
            sequence,
            timestamp: format!("2026-07-06T00:00:0{sequence}Z"),
            event_type: EventType::CardCast,
            payload: json!({ "match_id": "match-1", "seq": sequence }),
        })
        .collect();
    let report = ParseReport {
        raw_chunks: Vec::new(),
        events,
        next_offset: 0,
    };
    store.apply_report(&report).expect("events persist");
}

#[test]
fn sync_now_is_hard_gated_off_by_default() {
    let store_path = temp_path("sync-gate-store", "sqlite3");
    let settings_path = temp_path("sync-gate-settings", "json");
    seed_events(&store_path, 3);

    // Default settings have sync consent OFF. sync_now must not attempt any
    // network I/O — it returns immediately with attempted: false. (There is no
    // backend running, so any attempt would surface as an error/hang.)
    let outcome = sync_now(
        Some(store_path.to_string_lossy().as_ref()),
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("gated sync returns without error");

    assert!(!outcome.sync_enabled);
    assert!(!outcome.attempted, "no sync attempted when consent is off");
    assert_eq!(outcome.events_synced, 0);
    assert_eq!(outcome.batches_sent, 0);
    assert!(outcome.last_error.is_none());
    assert!(outcome.backend_url.ends_with("/events"));

    let _ = std::fs::remove_file(&store_path);
    let _ = std::fs::remove_file(&settings_path);
}

#[test]
fn enqueue_on_ingest_is_gated_by_consent() {
    let store_path = temp_path("enqueue-gate-store", "sqlite3");
    let settings_path = temp_path("enqueue-gate-settings", "json");
    seed_events(&store_path, 4);

    // Consent off → nothing enqueued.
    let enqueued_off = enqueue_ingested_events(
        Some(store_path.to_string_lossy().as_ref()),
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("enqueue returns");
    assert_eq!(enqueued_off, 0, "no enqueue while sync consent is off");

    let outbox_off = core_sync::Outbox::open(&store_path).expect("outbox opens");
    assert_eq!(outbox_off.pending_count().unwrap(), 0);
    drop(outbox_off);

    // Turn sync consent on, then enqueue mirrors the store into the outbox.
    set_consent("sync", true, Some(settings_path.to_string_lossy().as_ref()))
        .expect("sync consent persists");
    let enqueued_on = enqueue_ingested_events(
        Some(store_path.to_string_lossy().as_ref()),
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("enqueue returns");
    assert_eq!(enqueued_on, 4, "all four events mirrored to the outbox");

    // Idempotent: a second enqueue adds nothing.
    let enqueued_again = enqueue_ingested_events(
        Some(store_path.to_string_lossy().as_ref()),
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("enqueue returns");
    assert_eq!(enqueued_again, 0, "re-enqueue is idempotent");

    let outbox_on = core_sync::Outbox::open(&store_path).expect("outbox opens");
    assert_eq!(outbox_on.pending_count().unwrap(), 4);

    let _ = std::fs::remove_file(&store_path);
    let _ = std::fs::remove_file(&settings_path);
}
