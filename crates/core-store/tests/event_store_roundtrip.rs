use core_domain::{
    payload_value, ActionTarget, CardRef, EventType, GameAction, NormalizedEvent, ParseReport,
    Zone,
};
use core_parser::parse_log;
use core_store::{EventStore, IngestDiagnosticRecord};
use serde_json::json;
use std::fs;

#[test]
fn stores_raw_chunks_and_projects_match_inventory_and_draft_data() {
    let log = "\
2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Izzet Phoenix|queue=ranked
2026-05-06T21:06:00Z|MATCH_END|match_id=match-1|result=win|queue=ranked
2026-05-06T21:07:00Z|COLLECTION_SNAPSHOT|cards_owned=620
2026-05-06T21:08:00Z|INVENTORY_SNAPSHOT|gold=1200|gems=400|wildcards=12|vault=34
2026-05-06T21:09:00Z|DRAFT_PICK|set_code=OTJ|pack_number=1|pick_number=2|choice=Caustic Bronco
";

    let report = parse_log("session-1", log, 0).expect("test log should parse");
    let store = EventStore::open_in_memory().expect("store should be created");
    store.apply_report(&report).expect("report should persist");

    let events = store.load_events().expect("events should load");
    assert_eq!(events.len(), 5);
    assert_eq!(events[0].event_type, EventType::MatchStart);
    assert_eq!(
        payload_value(&events[4].payload, "choice").as_deref(),
        Some("Caustic Bronco")
    );

    let matches = store.load_match_history().expect("match history should load");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].deck, "Izzet Phoenix");
    assert_eq!(matches[0].result.as_deref(), Some("win"));

    let collection = store
        .latest_collection_snapshot()
        .expect("collection query should work")
        .expect("collection snapshot should exist");
    assert_eq!(collection.cards_owned, 620);

    let inventory = store
        .latest_inventory_snapshot()
        .expect("inventory query should work")
        .expect("inventory snapshot should exist");
    assert_eq!(inventory.gold, 1200);
    assert_eq!(inventory.wildcards, 12);

    let picks = store.load_draft_picks().expect("draft picks should load");
    assert_eq!(picks.len(), 1);
    assert_eq!(picks[0].choice, "Caustic Bronco");
}

#[test]
fn preserves_session_ingest_order_and_latest_snapshots_across_multiple_reports() {
    let first_log = "\
2026-05-06T21:00:00Z|MATCH_START|match_id=z-match|deck=Azorius Control|queue=ranked
2026-05-06T21:01:00Z|COLLECTION_SNAPSHOT|cards_owned=500
";
    let second_log = "\
2026-05-06T21:10:00Z|MATCH_START|match_id=a-match|deck=Temur Analyst|queue=play
2026-05-06T21:11:00Z|INVENTORY_SNAPSHOT|gold=6400|gems=1200|wildcards=22|vault=45
";

    let first_report = parse_log("session-1", first_log, 0).expect("first report should parse");
    let second_report = parse_log("session-2", second_log, first_report.next_offset)
        .expect("second report should parse");

    let store = EventStore::open_in_memory().expect("store should be created");
    store.apply_report(&first_report).expect("first report should persist");
    store.apply_report(&second_report).expect("second report should persist");

    let events = store.load_events().expect("events should load in insertion order");
    assert_eq!(events[0].session_id, "session-1");
    assert_eq!(events[2].session_id, "session-2");

    let matches = store.load_match_history().expect("match history should load");
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].match_id, "z-match");
    assert_eq!(matches[1].match_id, "a-match");

    let collection = store
        .latest_collection_snapshot()
        .expect("collection query should work")
        .expect("collection snapshot should exist");
    assert_eq!(collection.cards_owned, 500);

    let inventory = store
        .latest_inventory_snapshot()
        .expect("inventory query should work")
        .expect("inventory snapshot should exist");
    assert_eq!(inventory.gold, 6400);
}

#[test]
fn stores_raw_chunks_and_ingest_diagnostics_for_later_reprocessing() {
    let log = "\
2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Temur|queue=ranked
2026-05-06T21:01:00Z|PATCH_SPECIFIC_EVENT|foo=bar
";

    let report = parse_log("session-raw", log, 0).expect("test log should parse");
    let store = EventStore::open_in_memory().expect("store should be created");
    store.apply_report(&report).expect("report should persist");
    store
        .append_ingest_diagnostics(&[
            IngestDiagnosticRecord {
                session_id: "session-raw".to_owned(),
                source_path: "/tmp/Player.log".to_owned(),
                diagnostic_kind: "unknown-event".to_owned(),
                message: "unknown event label: PATCH_SPECIFIC_EVENT".to_owned(),
                detail_json: "{\"foo\":\"bar\"}".to_owned(),
            },
        ])
        .expect("diagnostics should persist");

    let raw_chunks = store
        .load_raw_chunks_for_session("session-raw")
        .expect("raw chunks should load");
    assert_eq!(raw_chunks.len(), 2);

    let diagnostics = store
        .load_ingest_diagnostics()
        .expect("diagnostics should load");
    assert_eq!(diagnostics.len(), 1);

    let unknown_events = store
        .load_unknown_event_labels()
        .expect("unknown events should load");
    assert_eq!(unknown_events, vec!["PATCH_SPECIFIC_EVENT".to_owned()]);
}

#[test]
fn projects_representative_mtga_json_log_fragments_into_existing_views() {
    let log = fs::read_to_string("../core-parser/tests/fixtures/mtga_detailed_log_sample.log")
        .expect("fixture log should be readable");

    let report = parse_log("session-json", &log, 0).expect("mtga fixture should parse");
    let store = EventStore::open_in_memory().expect("store should be created");
    store.apply_report(&report).expect("report should persist");

    let matches = store.load_match_history().expect("match history should load");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].match_id, "match-1");
    assert_eq!(matches[0].deck, "Esper Midrange");
    assert_eq!(matches[0].result.as_deref(), Some("win"));

    let collection = store
        .latest_collection_snapshot()
        .expect("collection query should work")
        .expect("collection snapshot should exist");
    assert_eq!(collection.cards_owned, 620);

    let inventory = store
        .latest_inventory_snapshot()
        .expect("inventory query should work")
        .expect("inventory snapshot should exist");
    assert_eq!(inventory.gold, 1200);
    assert_eq!(inventory.wildcards, 12);

    let picks = store.load_draft_picks().expect("draft picks should load");
    assert_eq!(picks.len(), 1);
    assert_eq!(picks[0].set_code, "OTJ");
    assert_eq!(picks[0].pick_number, 2);
}

#[test]
fn roundtrips_card_cast_event_with_nested_json_payload() {
    let action = GameAction::CastSpell {
        actor: "player-1".to_owned(),
        card_ref: Some(CardRef {
            name: Some("Lightning Strike".to_owned()),
            arena_id: Some(91234),
            scryfall_oracle_id: None,
        }),
        from_zone: Some(Zone::Hand),
        targets: vec![ActionTarget {
            player_ref: Some("player-2".to_owned()),
            ..ActionTarget::default()
        }],
        mana_spent: None,
    };
    let payload = json!({
        "match_id": "match-9",
        "grpId": 91234,
        "instanceId": 321,
        "action": serde_json::to_value(&action).expect("action should serialize"),
    });

    let report = ParseReport {
        raw_chunks: vec![],
        events: vec![NormalizedEvent {
            session_id: "session-gameplay".to_owned(),
            sequence: 1,
            timestamp: "2026-07-06T10:00:00Z".to_owned(),
            event_type: EventType::CardCast,
            payload: payload.clone(),
        }],
        next_offset: 0,
    };

    let store = EventStore::open_in_memory().expect("store should be created");
    let stats = store.apply_report(&report).expect("report should persist");
    assert_eq!(stats.inserted_events, 1);

    let events = store.load_events().expect("events should load");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, EventType::CardCast);
    assert_eq!(events[0].payload, payload);

    let restored: GameAction = serde_json::from_value(events[0].payload["action"].clone())
        .expect("nested action should deserialize");
    assert_eq!(restored, action);
    assert_eq!(restored.kind(), "castSpell");

    // Scalar lookups still work next to nested structures.
    assert_eq!(
        payload_value(&events[0].payload, "match_id").as_deref(),
        Some("match-9")
    );
    assert_eq!(
        payload_value(&events[0].payload, "grpId").as_deref(),
        Some("91234")
    );

    // Idempotency semantics are unchanged for structured payloads.
    let stats = store.apply_report(&report).expect("re-apply should persist");
    assert_eq!(stats.inserted_events, 0);
    assert_eq!(store.count_events().expect("count should work"), 1);
}

#[test]
fn loads_legacy_flat_map_payload_rows() {
    let db_path = std::env::temp_dir().join(format!(
        "mancutg-legacy-payload-{}-{:?}.sqlite",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_file(&db_path);

    // Create the schema, then simulate a legacy row written before the
    // structured-payload change: payload_json is a flat string map.
    {
        let store = EventStore::open(&db_path).expect("store should be created");
        drop(store);

        let connection = rusqlite::Connection::open(&db_path).expect("db should open");
        connection
            .execute(
                "INSERT INTO events (session_id, sequence, timestamp, event_type, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    "session-legacy",
                    1_i64,
                    "2026-05-06T21:00:00Z",
                    "MATCH_END",
                    "{\"match_id\":\"match-legacy\",\"deck\":\"Izzet Phoenix\",\"result\":\"win\"}",
                ],
            )
            .expect("legacy row should insert");
    }

    let store = EventStore::open(&db_path).expect("store should reopen");
    let events = store.load_events().expect("legacy events should load");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, EventType::MatchEnd);
    assert_eq!(
        events[0].payload,
        json!({ "match_id": "match-legacy", "deck": "Izzet Phoenix", "result": "win" })
    );
    assert_eq!(
        payload_value(&events[0].payload, "deck").as_deref(),
        Some("Izzet Phoenix")
    );

    // Projections read legacy rows unchanged (migration-on-read).
    let matches = store.load_match_history().expect("match history should load");
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].match_id, "match-legacy");
    assert_eq!(matches[0].result.as_deref(), Some("win"));

    drop(store);
    let _ = fs::remove_file(&db_path);
}
