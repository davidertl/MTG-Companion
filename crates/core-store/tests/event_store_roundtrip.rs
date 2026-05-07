use core_domain::{payload_value, EventType};
use core_parser::parse_log;
use core_store::{EventStore, IngestDiagnosticRecord};

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
