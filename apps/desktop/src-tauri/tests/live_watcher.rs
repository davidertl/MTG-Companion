use core_store::EventStore;
use mancutg_arenac::{watch_live_log_follow, watch_live_log_once};
use std::{
    fs,
    io::Write,
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
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

// The bounded window every follow-loop assertion waits within. Generous
// enough to be robust on slow CI, short enough to keep the suite quick.
const FOLLOW_WINDOW: Duration = Duration::from_secs(5);
// Fast poll interval so tests do not wait on the 2s production fallback;
// `notify` events should trigger ingests even sooner.
const FOLLOW_POLL: Duration = Duration::from_millis(50);

#[test]
fn follow_ingests_appends_within_bounded_window() {
    let log_path = temp_path("follow-log", "log");
    let store_path = temp_path("follow-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Domain Ramp|queue=ranked\n",
    )
    .expect("initial log should be written");

    let (ingest_tx, ingest_rx) = mpsc::channel::<()>();
    let handle = watch_live_log_follow(
        log_path.clone(),
        Some(store_path.to_string_lossy().into_owned()),
        FOLLOW_POLL,
        move |_summary| {
            let _ = ingest_tx.send(());
        },
    )
    .expect("follow watcher should start");

    ingest_rx
        .recv_timeout(FOLLOW_WINDOW)
        .expect("initial content should be ingested within the window");

    fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .expect("log should open for append")
        .write_all(b"2026-05-07T02:01:00Z|MATCH_END|match_id=match-1|result=win|queue=ranked\n")
        .expect("append should succeed");

    ingest_rx
        .recv_timeout(FOLLOW_WINDOW)
        .expect("appended line should be ingested within the window");

    handle.stop();
    handle.join();

    let store = EventStore::open(&store_path).expect("store should be readable");
    // Exactly two events: the checkpoint machinery prevents duplicate ingest.
    assert_eq!(store.count_events().expect("event count should load"), 2);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn follow_stop_is_idempotent_and_terminates_cleanly() {
    let log_path = temp_path("follow-stop-log", "log");
    let store_path = temp_path("follow-stop-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Esper|queue=ranked\n",
    )
    .expect("initial log should be written");

    let handle = watch_live_log_follow(
        log_path.clone(),
        Some(store_path.to_string_lossy().into_owned()),
        FOLLOW_POLL,
        |_summary| {},
    )
    .expect("follow watcher should start");

    handle.stop();
    // Stopping twice must be harmless.
    handle.stop();
    handle.join();

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn follow_handles_rotation_mid_stream() {
    let log_path = temp_path("follow-rotate-log", "log");
    let store_path = temp_path("follow-rotate-store", "sqlite3");

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Domain Ramp|queue=ranked\n",
    )
    .expect("initial log should be written");

    let (ingest_tx, ingest_rx) = mpsc::channel::<()>();
    let handle = watch_live_log_follow(
        log_path.clone(),
        Some(store_path.to_string_lossy().into_owned()),
        FOLLOW_POLL,
        move |_summary| {
            let _ = ingest_tx.send(());
        },
    )
    .expect("follow watcher should start");

    ingest_rx
        .recv_timeout(FOLLOW_WINDOW)
        .expect("initial content should be ingested");

    // Rotation: the log is replaced by a fresh file with different content.
    fs::write(
        &log_path,
        "2026-05-07T02:05:00Z|MATCH_START|match_id=match-2|deck=Boros|queue=play\n",
    )
    .expect("rotated log should be written");

    ingest_rx
        .recv_timeout(FOLLOW_WINDOW)
        .expect("rotated content should be ingested without crashing");

    handle.stop();
    handle.join();

    let store = EventStore::open(&store_path).expect("store should be readable");
    // Rotation starts a fresh live session; both matches are captured.
    assert!(
        store
            .load_log_sessions()
            .expect("sessions should load")
            .len()
            >= 2
    );
    assert_eq!(store.count_events().expect("event count should load"), 2);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn follow_waits_for_missing_file_without_crashing() {
    let log_path = temp_path("follow-missing-log", "log");
    let store_path = temp_path("follow-missing-store", "sqlite3");

    // Intentionally do not create the log file yet.
    let (ingest_tx, ingest_rx) = mpsc::channel::<()>();
    let handle = watch_live_log_follow(
        log_path.clone(),
        Some(store_path.to_string_lossy().into_owned()),
        FOLLOW_POLL,
        move |_summary| {
            let _ = ingest_tx.send(());
        },
    )
    .expect("follow watcher should start even when the file is missing");

    // No ingest should occur while the file is absent; the loop keeps waiting.
    assert!(
        ingest_rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "no events should be ingested before the log file exists"
    );

    fs::write(
        &log_path,
        "2026-05-07T02:00:00Z|MATCH_START|match_id=match-1|deck=Azorius|queue=ranked\n",
    )
    .expect("log should be creatable");

    ingest_rx
        .recv_timeout(FOLLOW_WINDOW)
        .expect("content should be ingested once the file appears");

    handle.stop();
    handle.join();

    let store = EventStore::open(&store_path).expect("store should be readable");
    assert_eq!(store.count_events().expect("event count should load"), 1);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
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
