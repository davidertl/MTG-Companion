use core_domain::{ImportSourceKind, PlatformTag};
use core_store::EventStore;
use mancutg_arenac::import_ios_logs;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_path(name: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mancutg-arenac-{name}-{timestamp}"))
}

#[test]
fn imports_dragged_ios_log_files_and_tags_sessions_as_ios() {
    let log_path = temp_path("ios-file").with_extension("log");
    fs::write(
        &log_path,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=ios-match-1|deck=Domain Ramp|queue=play
2026-05-06T21:05:00Z|COLLECTION_SNAPSHOT|cards_owned=711
",
    )
    .expect("test log should be written");

    let store = EventStore::open_in_memory().expect("store should be created");
    let summary = import_ios_logs(&store, ImportSourceKind::DragAndDrop, vec![log_path.clone()])
        .expect("iOS import should succeed");

    assert_eq!(summary.platform_tag, PlatformTag::Ios);
    assert_eq!(summary.source_kind, ImportSourceKind::DragAndDrop);
    assert_eq!(summary.discovered_log_files, 1);
    assert_eq!(summary.imported_sessions, 1);
    assert_eq!(summary.duplicate_sessions, 0);
    assert_eq!(summary.inserted_events, 2);

    let sessions = store.load_log_sessions().expect("sessions should load");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform_tag, PlatformTag::Ios);
    assert_eq!(sessions[0].source_kind, ImportSourceKind::DragAndDrop);

    fs::remove_file(log_path).expect("temporary log should be removable");
}

#[test]
fn imports_ios_log_folders_recursively_and_deduplicates_repeated_imports() {
    let import_dir = temp_path("ios-folder");
    let nested_dir = import_dir.join("nested");
    fs::create_dir_all(&nested_dir).expect("nested directory should exist");

    let first_log = import_dir.join("Player-1.log");
    let second_log = nested_dir.join("Player-2.log");
    let ignored_file = nested_dir.join("notes.txt");

    fs::write(
        &first_log,
        "\
2026-05-06T21:00:00Z|MATCH_START|match_id=ios-match-1|deck=Azorius Control|queue=play
2026-05-06T21:05:00Z|MATCH_END|match_id=ios-match-1|result=win|queue=play
",
    )
    .expect("first log should be written");
    fs::write(
        &second_log,
        "\
2026-05-06T21:10:00Z|MATCH_START|match_id=ios-match-2|deck=Jeskai Convoke|queue=ranked
2026-05-06T21:12:00Z|INVENTORY_SNAPSHOT|gold=1200|gems=300|wildcards=10|vault=15
",
    )
    .expect("second log should be written");
    fs::write(&ignored_file, "not a log").expect("ignored file should be written");

    let store = EventStore::open_in_memory().expect("store should be created");
    let first_summary = import_ios_logs(&store, ImportSourceKind::FolderImport, vec![import_dir.clone()])
        .expect("folder import should succeed");

    assert_eq!(first_summary.discovered_log_files, 2);
    assert_eq!(first_summary.imported_sessions, 2);
    assert_eq!(first_summary.duplicate_sessions, 0);
    assert_eq!(store.count_events().expect("event count should load"), 4);

    let second_summary =
        import_ios_logs(&store, ImportSourceKind::FolderImport, vec![import_dir.clone()])
            .expect("repeated folder import should succeed");

    assert_eq!(second_summary.discovered_log_files, 2);
    assert_eq!(second_summary.imported_sessions, 0);
    assert_eq!(second_summary.duplicate_sessions, 2);
    assert_eq!(second_summary.inserted_raw_chunks, 0);
    assert_eq!(second_summary.inserted_events, 0);
    assert_eq!(store.count_events().expect("event count should remain stable"), 4);

    let sessions = store.load_log_sessions().expect("sessions should load");
    assert_eq!(sessions.len(), 2);
    assert!(sessions
        .iter()
        .all(|session| session.platform_tag == PlatformTag::Ios && session.source_kind == ImportSourceKind::FolderImport));

    fs::remove_dir_all(import_dir).expect("temporary import directory should be removable");
}
