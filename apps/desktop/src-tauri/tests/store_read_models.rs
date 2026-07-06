use mancutg_arenac::{
    export_backup_bundle, inspect_local_store, inspect_match, reprocess_session,
    watch_live_log_once,
};
use std::{
    fs,
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
fn inspects_local_store_and_surfaces_sessions_diagnostics_and_unknown_events() {
    let log_path = temp_path("inspect-log", "log");
    let store_path = temp_path("inspect-store", "sqlite3");

    fs::write(
        &log_path,
        "\
2026-05-07T03:00:00Z|MATCH_START|match_id=match-1|deck=Azorius|queue=ranked
2026-05-07T03:01:00Z|PATCH_SPECIFIC_EVENT|foo=bar
",
    )
    .expect("log should be written");

    let watch_summary = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch should succeed");
    assert_eq!(watch_summary.inserted_events, 2);

    let summary = inspect_local_store(Some(store_path.to_string_lossy().as_ref()))
        .expect("store summary should succeed");
    assert_eq!(summary.sessions.len(), 1);
    assert_eq!(summary.match_history.len(), 1);
    assert_eq!(summary.unknown_events.len(), 1);
    assert!(!summary.diagnostics.is_empty());
    assert_eq!(summary.checkpoints.len(), 1);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn inspect_match_returns_only_events_for_the_requested_match() {
    let log_path = temp_path("inspect-match-log", "log");
    let store_path = temp_path("inspect-match-store", "sqlite3");

    fs::write(
        &log_path,
        "\
2026-05-07T04:00:00Z|MATCH_START|match_id=match-1|deck=Azorius|queue=ranked
2026-05-07T04:01:00Z|MATCH_END|match_id=match-1|result=win
2026-05-07T04:02:00Z|MATCH_START|match_id=match-2|deck=Rakdos|queue=play
",
    )
    .expect("log should be written");

    watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch should succeed");

    let inspection = inspect_match("match-1", Some(store_path.to_string_lossy().as_ref()))
        .expect("match inspection should succeed");

    assert_eq!(inspection.match_id, "match-1");
    assert_eq!(inspection.events.len(), 2);
    assert_eq!(inspection.events[0].event_type, "MATCH_START");
    assert_eq!(inspection.events[1].event_type, "MATCH_END");
    assert!(inspection.events[0].payload_json.contains("match-1"));

    let empty = inspect_match("does-not-exist", Some(store_path.to_string_lossy().as_ref()))
        .expect("missing match inspection should succeed");
    assert!(empty.events.is_empty());

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn reprocesses_a_session_from_stored_raw_chunks() {
    let log_path = temp_path("reprocess-log", "log");
    let store_path = temp_path("reprocess-store", "sqlite3");

    fs::write(
        &log_path,
        "\
2026-05-07T03:10:00Z|MATCH_START|match_id=match-1|deck=Esper|queue=play
2026-05-07T03:11:00Z|DRAFT_PICK|set_code=OTJ|pack_number=1|pick_number=3|choice=Vaultborn Tyrant
",
    )
    .expect("log should be written");

    let watch_summary = watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch should succeed");

    let reprocessed =
        reprocess_session(&watch_summary.session_id, Some(store_path.to_string_lossy().as_ref()))
            .expect("reprocess should succeed");

    assert_eq!(reprocessed.raw_chunk_count, 2);
    assert_eq!(reprocessed.reparsed_event_count, 2);
    assert!(reprocessed.parse_warnings.is_empty());

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}

#[test]
fn exports_a_backup_bundle_from_the_local_store() {
    let log_path = temp_path("backup-log", "log");
    let store_path = temp_path("backup-store", "sqlite3");

    fs::write(
        &log_path,
        "\
2026-05-07T03:20:00Z|MATCH_START|match_id=match-1|deck=Jeskai|queue=play
2026-05-07T03:21:00Z|INVENTORY_SNAPSHOT|gold=3200|gems=100|wildcards=7|vault=12
",
    )
    .expect("log should be written");

    watch_live_log_once(&log_path, Some(store_path.to_string_lossy().as_ref()))
        .expect("watch should succeed");

    let backup = export_backup_bundle(Some(store_path.to_string_lossy().as_ref()))
        .expect("backup export should succeed");

    assert_eq!(backup.sessions.len(), 1);
    assert_eq!(backup.match_history.len(), 1);
    assert_eq!(backup.inventory_snapshot.map(|snapshot| snapshot.gold), Some(3200));
    assert_eq!(backup.checkpoints.len(), 1);

    fs::remove_file(log_path).expect("temporary log should be removable");
    fs::remove_file(store_path).expect("temporary store should be removable");
}
