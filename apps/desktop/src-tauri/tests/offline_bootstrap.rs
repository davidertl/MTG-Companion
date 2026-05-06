use desktop_core::{bootstrap_local_companion, run_cli};
use std::{fs, time::{SystemTime, UNIX_EPOCH}};

#[test]
fn boots_the_companion_from_a_log_file_without_backend_access() {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let log_path = std::env::temp_dir().join(format!("mtg-companion-{timestamp}.log"));
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Domain Ramp|queue=ranked
2026-05-06T21:05:00Z|COLLECTION_SNAPSHOT|cards_owned=711
2026-05-06T21:08:00Z|INVENTORY_SNAPSHOT|gold=5600|gems=1200|wildcards=18|vault=42
2026-05-06T21:12:00Z|DRAFT_PICK|set_code=OTJ|pack_number=1|pick_number=4|choice=Railway Brawler
",
    )
    .expect("log file should be written");

    let bootstrap = bootstrap_local_companion("session-1", &log_path)
        .expect("desktop bootstrap should succeed");

    assert_eq!(bootstrap.match_history.len(), 1);
    assert_eq!(bootstrap.match_history[0].deck, "Domain Ramp");
    assert_eq!(bootstrap.collection_snapshot.map(|snapshot| snapshot.cards_owned), Some(711));
    assert_eq!(bootstrap.inventory_snapshot.map(|snapshot| snapshot.gold), Some(5600));
    assert_eq!(bootstrap.draft_picks.len(), 1);
    assert!(bootstrap.unknown_events.is_empty());
    assert!(bootstrap.parse_warnings.is_empty());

    fs::remove_file(log_path).expect("temporary log file should be removable");
}

#[test]
fn keeps_bootstrapping_when_one_log_line_is_malformed() {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let log_path = std::env::temp_dir().join(format!("mtg-companion-malformed-{timestamp}.log"));
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Domain Ramp|queue=ranked
2026-05-06T21:01:00Z|MATCH_START|match_id
2026-05-06T21:05:00Z|COLLECTION_SNAPSHOT|cards_owned=711
",
    )
    .expect("log file should be written");

    let bootstrap = bootstrap_local_companion("session-1", &log_path)
        .expect("desktop bootstrap should degrade gracefully");

    assert_eq!(bootstrap.match_history.len(), 1);
    assert_eq!(bootstrap.collection_snapshot.map(|snapshot| snapshot.cards_owned), Some(711));
    assert_eq!(bootstrap.parse_warnings.len(), 1);

    fs::remove_file(log_path).expect("temporary log file should be removable");
}

#[test]
fn exposes_bootstrap_as_a_cli_entrypoint() {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let log_path = std::env::temp_dir().join(format!("mtg-companion-cli-{timestamp}.log"));
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=cli-match-1|deck=Mono Red|queue=play
2026-05-06T21:05:00Z|INVENTORY_SNAPSHOT|gold=2200|gems=150|wildcards=9|vault=5
",
    )
    .expect("log file should be written");

    let output = run_cli(&[
        "bootstrap".to_owned(),
        log_path.to_string_lossy().into_owned(),
    ])
    .expect("CLI bootstrap should succeed");

    let parsed: serde_json::Value =
        serde_json::from_str(&output).expect("CLI bootstrap should return valid JSON");
    assert_eq!(parsed["matchHistory"][0]["deck"], "Mono Red");
    assert_eq!(parsed["inventorySnapshot"]["gold"], 2200);

    fs::remove_file(log_path).expect("temporary log file should be removable");
}
