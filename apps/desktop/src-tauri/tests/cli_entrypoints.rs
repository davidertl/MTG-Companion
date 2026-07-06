use mancutg_arenac::run_cli;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_path(name: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mancutg-arenac-cli-{timestamp}-{name}"))
}

#[test]
fn cli_bootstrap_returns_structured_json() {
    let log_path = temp_path("bootstrap.log");
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=cli-match|deck=Esper Pixie|queue=play
2026-05-06T21:05:00Z|COLLECTION_SNAPSHOT|cards_owned=450
",
    )
    .expect("log file should be written");

    let output = run_cli(&[
        "bootstrap".to_owned(),
        log_path.to_string_lossy().into_owned(),
    ])
    .expect("cli bootstrap should succeed");
    let json: serde_json::Value =
        serde_json::from_str(&output).expect("cli bootstrap should return json");

    assert_eq!(json["matchHistory"][0]["deck"], "Esper Pixie");
    assert_eq!(json["collectionSnapshot"]["cards_owned"], 450);

    fs::remove_file(log_path).expect("temporary log should be removable");
}

#[test]
fn cli_import_ios_file_returns_import_summary() {
    let log_path = temp_path("ios-file.log");
    let store_path = temp_path("store.sqlite3");
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=ios-cli-match|deck=Gruul Prowess|queue=play
",
    )
    .expect("log file should be written");

    let output = run_cli(&[
        "import-ios-file".to_owned(),
        log_path.to_string_lossy().into_owned(),
        store_path.to_string_lossy().into_owned(),
    ])
    .expect("cli iOS import should succeed");
    let json: serde_json::Value =
        serde_json::from_str(&output).expect("cli import should return json");

    assert_eq!(json["platformTag"], "ios");
    assert_eq!(json["importedSessions"], 1);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn cli_card_db_import_and_status_report_counts() {
    let bulk_path = temp_path("oracle-cards.json");
    let card_db_path = temp_path("cards.sqlite");
    fs::write(
        &bulk_path,
        r#"[
  {
    "id": "33333333-3333-4333-8333-000000000001",
    "oracle_id": "44444444-4444-4444-8444-000000000001",
    "name": "Fixture Bolt",
    "mana_cost": "{R}",
    "cmc": 1.0,
    "type_line": "Instant",
    "oracle_text": "Fixture Bolt deals 3 damage to any target.",
    "colors": ["R"],
    "keywords": [],
    "legalities": { "historic": "legal" },
    "set": "tst",
    "arena_id": 90001
  },
  {
    "id": "33333333-3333-4333-8333-000000000002",
    "oracle_id": "44444444-4444-4444-8444-000000000002",
    "name": "Fixture Bear",
    "mana_cost": "{1}{G}",
    "cmc": 2.0,
    "type_line": "Creature — Bear",
    "colors": ["G"],
    "set": "tst"
  }
]"#,
    )
    .expect("bulk fixture should be written");

    let import_output = run_cli(&[
        "import-card-db".to_owned(),
        bulk_path.to_string_lossy().into_owned(),
        card_db_path.to_string_lossy().into_owned(),
    ])
    .expect("cli card db import should succeed");
    let import_json: serde_json::Value =
        serde_json::from_str(&import_output).expect("cli card db import should return json");

    assert_eq!(import_json["importedCards"], 2);
    assert_eq!(import_json["skippedEntries"], 0);
    assert_eq!(import_json["cardCount"], 2);
    assert_eq!(import_json["withArenaIdCount"], 1);

    let status_output = run_cli(&[
        "card-db-status".to_owned(),
        card_db_path.to_string_lossy().into_owned(),
    ])
    .expect("cli card db status should succeed");
    let status_json: serde_json::Value =
        serde_json::from_str(&status_output).expect("cli card db status should return json");

    assert_eq!(status_json["cardDbExists"], true);
    assert_eq!(status_json["cardCount"], 2);
    assert_eq!(status_json["withArenaIdCount"], 1);

    fs::remove_file(bulk_path).expect("temporary bulk file should be removable");
    fs::remove_file(card_db_path).expect("temporary card db should be removable");
}

#[test]
fn cli_card_db_status_reports_missing_database_without_creating_it() {
    let card_db_path = temp_path("missing-cards.sqlite");

    let output = run_cli(&[
        "card-db-status".to_owned(),
        card_db_path.to_string_lossy().into_owned(),
    ])
    .expect("cli card db status should succeed for a missing database");
    let json: serde_json::Value =
        serde_json::from_str(&output).expect("cli card db status should return json");

    assert_eq!(json["cardDbExists"], false);
    assert_eq!(json["cardCount"], 0);
    assert!(
        !card_db_path.exists(),
        "status must not create the card database file"
    );
}

#[test]
fn cli_usage_documents_card_db_commands_and_scryfall_source() {
    let usage = mancutg_arenac::cli_usage();

    assert!(usage.contains("import-card-db"));
    assert!(usage.contains("card-db-status"));
    assert!(usage.contains("https://scryfall.com/docs/api/bulk-data"));
}

#[test]
fn cli_watch_log_returns_incremental_watch_summary() {
    let log_path = temp_path("watch.log");
    let store_path = temp_path("watch-store.sqlite3");
    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=watch-match|deck=Izzet|queue=play\n",
    )
    .expect("log file should be written");

    let output = run_cli(&[
        "watch-log".to_owned(),
        log_path.to_string_lossy().into_owned(),
        store_path.to_string_lossy().into_owned(),
    ])
    .expect("cli watch-log should succeed");
    let json: serde_json::Value =
        serde_json::from_str(&output).expect("cli watch-log should return json");

    assert_eq!(json["insertedEvents"], 1);
    assert_eq!(json["startingOffset"], 0);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}
