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
