use core_store::EventStore;
use mancutg_arenac::watch_live_log_once;
use std::{
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_path(name: &str, extension: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mancutg-arenac-{name}-{timestamp}.{extension}"))
}

#[test]
fn watches_appends_without_duplicate_events() {
    let log_path = temp_path("watch-log", "log");
    let store_path = temp_path("watch-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Domain Ramp|queue=ranked\n",
    )
    .expect("initial log should be written");

    let first = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("first watch should succeed");
    assert_eq!(first.inserted_events, 1);
    assert_eq!(first.starting_offset, 0);

    let second = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("second watch should succeed");
    assert_eq!(second.inserted_events, 0);
    assert_eq!(second.starting_offset, first.ending_offset);

    fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .expect("log should open for append")
        .write_all(b"2026-05-07T02:01:00Z|MATCH_END|match_id=match-1|result=win|queue=ranked\n")
        .expect("append should succeed");

    let third = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("third watch should succeed");
    assert_eq!(third.inserted_events, 1);

    let store = EventStore::open(&store_path).expect("store should be readable");
    assert_eq!(store.count_events().expect("event count should load"), 2);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn detects_truncation_and_starts_a_new_live_session() {
    let log_path = temp_path("truncate-log", "log");
    let store_path = temp_path("truncate-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Esper|queue=ranked\n",
    )
    .expect("initial log should be written");

    let first = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("initial watch should succeed");

    fs::write(
        &log_path,
        "2026-05-07T02:05:00Z|MATCH_START|match_id=match-2|deck=Boros|queue=play\n",
    )
    .expect("truncated replacement log should be written");

    let second = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch after truncation should succeed");

    assert!(second.truncation_detected || second.rotation_detected);
    assert_ne!(first.session_id, second.session_id);

    let store = EventStore::open(&store_path).expect("store should be readable");
    assert_eq!(
        store
            .load_log_sessions()
            .expect("sessions should load")
            .len(),
        2
    );

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn buffers_partial_lines_until_they_are_completed() {
    let log_path = temp_path("partial-log", "log");
    let store_path = temp_path("partial-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Azorius",
    )
    .expect("partial log should be written");

    let first = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch with partial line should succeed");
    assert_eq!(first.inserted_events, 0);
    assert!(first.pending_fragment_bytes > 0);

    fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .expect("partial log should reopen")
        .write_all(b"|queue=ranked\n")
        .expect("append should complete line");

    let second = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch after completing line should succeed");
    assert_eq!(second.inserted_events, 1);
    assert_eq!(second.pending_fragment_bytes, 0);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn returns_a_clear_error_for_invalid_log_paths() {
    let missing_path = temp_path("missing-log", "log");
    let store_path = temp_path("missing-store", "sqlite3");

    let error = watch_live_log_once(&missing_path, Some(store_path.to_string_lossy().as_ref()))
        .expect_err("invalid path should fail");
    assert!(error.contains("failed to read log file"));
}

#[test]
fn accepts_empty_files_without_crashing() {
    let log_path = temp_path("empty-log", "log");
    let store_path = temp_path("empty-store", "sqlite3");
    fs::write(&log_path, "").expect("empty file should be written");

    let summary = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("empty file should not fail");
    assert_eq!(summary.inserted_events, 0);
    assert_eq!(summary.ending_offset, 0);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}
