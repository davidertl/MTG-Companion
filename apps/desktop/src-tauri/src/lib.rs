use core_domain::{
    CollectionSnapshot, DraftPick, EventType, ImportSourceKind, InventorySnapshot, LogSession,
    MatchRecord, PlatformTag,
};
use core_parser::parse_log_lossy;
use core_store::{EventStore, LogCheckpointRecord};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    env,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBootstrap {
    pub match_history: Vec<MatchRecord>,
    pub collection_snapshot: Option<CollectionSnapshot>,
    pub inventory_snapshot: Option<InventorySnapshot>,
    pub draft_picks: Vec<DraftPick>,
    pub unknown_events: Vec<String>,
    pub parse_warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfflineLogImportRequest {
    pub platform_tag: PlatformTag,
    pub source_kind: ImportSourceKind,
    pub roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineLogImportSummary {
    pub platform_tag: PlatformTag,
    pub source_kind: ImportSourceKind,
    pub discovered_log_files: usize,
    pub imported_sessions: usize,
    pub duplicate_sessions: usize,
    pub inserted_raw_chunks: usize,
    pub inserted_events: usize,
    pub imported_paths: Vec<String>,
    pub parse_warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveLogWatchSummary {
    pub log_path: String,
    pub session_id: String,
    pub source_kind: String,
    pub starting_offset: u64,
    pub ending_offset: u64,
    pub inserted_raw_chunks: usize,
    pub inserted_events: usize,
    pub parse_warnings: Vec<String>,
    pub unknown_events: Vec<String>,
    pub rotation_detected: bool,
    pub truncation_detected: bool,
    pub pending_fragment_bytes: usize,
}

fn default_store_path() -> Result<PathBuf, String> {
    env::current_dir()
        .map(|cwd| cwd.join("mancutg-arenac.sqlite3"))
        .map_err(|error| format!("failed to determine current directory: {error}"))
}

fn open_store(optional_store_path: Option<&str>) -> Result<EventStore, String> {
    let store_path = match optional_store_path {
        Some(path) => PathBuf::from(path),
        None => default_store_path()?,
    };
    EventStore::open(&store_path).map_err(|error| format!("failed to open store {}: {error}", store_path.display()))
}

pub fn bootstrap_local_companion(
    session_id: &str,
    log_path: impl AsRef<Path>,
) -> Result<DesktopBootstrap, String> {
    let content = fs::read_to_string(log_path.as_ref())
        .map_err(|error| format!("failed to read log file: {error}"))?;
    let lossy_report = parse_log_lossy(session_id, &content, 0);
    let unknown_events = lossy_report
        .report
        .events
        .iter()
        .filter_map(|event| match &event.event_type {
            EventType::Unknown(label) => Some(label.clone()),
            _ => None,
        })
        .collect();
    let store = EventStore::open_in_memory().map_err(|error| error.to_string())?;
    store
        .apply_report(&lossy_report.report)
        .map_err(|error| format!("failed to persist log report: {error}"))?;

    Ok(DesktopBootstrap {
        match_history: store.load_match_history().map_err(|error| error.to_string())?,
        collection_snapshot: store
            .latest_collection_snapshot()
            .map_err(|error| error.to_string())?,
        inventory_snapshot: store
            .latest_inventory_snapshot()
            .map_err(|error| error.to_string())?,
        draft_picks: store.load_draft_picks().map_err(|error| error.to_string())?,
        unknown_events,
        parse_warnings: lossy_report
            .warnings
            .into_iter()
            .map(|warning| warning.message)
            .collect(),
    })
}

pub fn bootstrap_local_state(log_path: impl AsRef<Path>) -> Result<DesktopBootstrap, String> {
    bootstrap_local_companion("desktop-bootstrap", log_path)
}

pub fn import_offline_logs(
    store: &EventStore,
    request: &OfflineLogImportRequest,
) -> Result<OfflineLogImportSummary, String> {
    let log_files = collect_log_files(&request.roots)?;
    let mut imported_sessions = 0;
    let mut duplicate_sessions = 0;
    let mut inserted_raw_chunks = 0;
    let mut inserted_events = 0;
    let mut imported_paths = Vec::new();
    let mut parse_warnings = Vec::new();

    for log_path in &log_files {
        let content =
            fs::read_to_string(log_path).map_err(|error| format!("failed to read log file: {error}"))?;
        let session_id = build_import_session_id(&request.platform_tag, &content);
        let session = LogSession {
            session_id: session_id.clone(),
            platform_tag: request.platform_tag.clone(),
            source_kind: request.source_kind.clone(),
            source_path: log_path.to_string_lossy().into_owned(),
        };

        let inserted_session = store
            .upsert_log_session(&session)
            .map_err(|error| format!("failed to persist log session: {error}"))?;
        let lossy_report = parse_log_lossy(&session_id, &content, 0);
        let persist_stats = store
            .apply_report(&lossy_report.report)
            .map_err(|error| format!("failed to persist imported log data: {error}"))?;

        if inserted_session || persist_stats.inserted_events > 0 || persist_stats.inserted_raw_chunks > 0 {
            imported_sessions += 1;
        } else {
            duplicate_sessions += 1;
        }

        inserted_raw_chunks += persist_stats.inserted_raw_chunks;
        inserted_events += persist_stats.inserted_events;
        imported_paths.push(session.source_path);
        parse_warnings.extend(
            lossy_report
                .warnings
                .into_iter()
                .map(|warning| format!("{}: {}", log_path.display(), warning.message)),
        );
    }

    Ok(OfflineLogImportSummary {
        platform_tag: request.platform_tag.clone(),
        source_kind: request.source_kind.clone(),
        discovered_log_files: log_files.len(),
        imported_sessions,
        duplicate_sessions,
        inserted_raw_chunks,
        inserted_events,
        imported_paths,
        parse_warnings,
    })
}

pub fn import_ios_logs(
    store: &EventStore,
    source_kind: ImportSourceKind,
    roots: Vec<PathBuf>,
) -> Result<OfflineLogImportSummary, String> {
    import_offline_logs(
        store,
        &OfflineLogImportRequest {
            platform_tag: PlatformTag::Ios,
            source_kind,
            roots,
        },
    )
}

pub fn watch_live_log_once(
    log_path: impl AsRef<Path>,
    optional_store_path: Option<&str>,
) -> Result<LiveLogWatchSummary, String> {
    let store = open_store(optional_store_path)?;
    watch_live_log_once_with_store(&store, log_path)
}

pub fn watch_live_log_once_with_store(
    store: &EventStore,
    log_path: impl AsRef<Path>,
) -> Result<LiveLogWatchSummary, String> {
    let log_path = log_path.as_ref();
    let path_string = log_path.to_string_lossy().into_owned();
    let bytes = fs::read(log_path)
        .map_err(|error| format!("failed to read log file {}: {error}", log_path.display()))?;
    let current_offset = bytes.len() as u64;
    let source_fingerprint = build_live_watch_fingerprint(&bytes);
    let checkpoint = store
        .load_log_checkpoint(&path_string)
        .map_err(|error| format!("failed to load log checkpoint: {error}"))?;

    let mut rotation_detected = false;
    let mut truncation_detected = false;
    let mut starting_offset = 0_u64;
    let mut pending_fragment = String::new();
    let mut previous_sequence = 0_u64;
    let session_id = if let Some(checkpoint) = checkpoint {
        let fingerprint_changed = !fingerprint_matches(&checkpoint.source_fingerprint, &bytes);
        let truncated = checkpoint.byte_offset > current_offset;
        if truncated || fingerprint_changed {
            truncation_detected = truncated;
            rotation_detected = fingerprint_changed;
            build_live_watch_session_id(log_path, &source_fingerprint)
        } else {
            starting_offset = checkpoint.byte_offset;
            pending_fragment = checkpoint.pending_fragment;
            previous_sequence = checkpoint.last_sequence;
            checkpoint.session_id
        }
    } else {
        build_live_watch_session_id(log_path, &source_fingerprint)
    };

    let unread_bytes = if starting_offset as usize > bytes.len() {
        &[][..]
    } else {
        &bytes[starting_offset as usize..]
    };
    let unread_text = String::from_utf8_lossy(unread_bytes);
    let combined_text = format!("{pending_fragment}{unread_text}");
    let (committed_text, next_pending_fragment) = split_committed_text(&combined_text);
    let committed_start_offset =
        starting_offset.saturating_sub(pending_fragment.as_bytes().len() as u64);

    let session = LogSession {
        session_id: session_id.clone(),
        platform_tag: PlatformTag::Desktop,
        source_kind: ImportSourceKind::LiveWatch,
        source_path: path_string.clone(),
    };
    store
        .upsert_log_session(&session)
        .map_err(|error| format!("failed to persist live log session: {error}"))?;

    let mut inserted_raw_chunks = 0;
    let mut inserted_events = 0;
    let mut parse_warnings = Vec::new();
    let mut unknown_events = Vec::new();
    let mut sequence_advance = 0_u64;

    if !committed_text.is_empty() {
        let mut lossy_report = parse_log_lossy(&session_id, &committed_text, committed_start_offset);
        sequence_advance = max_consumed_sequence(
            lossy_report
                .report
                .events
                .iter()
                .map(|event| event.sequence)
                .max()
                .unwrap_or(0),
            lossy_report
                .warnings
                .iter()
                .map(|warning| warning.sequence)
                .max()
                .unwrap_or(0),
        );

        for event in &mut lossy_report.report.events {
            event.sequence += previous_sequence;
        }
        unknown_events = lossy_report
            .report
            .events
            .iter()
            .filter_map(|event| match &event.event_type {
                EventType::Unknown(label) => Some(label.clone()),
                _ => None,
            })
            .collect();
        let persist_stats = store
            .apply_report(&lossy_report.report)
            .map_err(|error| format!("failed to persist watched log data: {error}"))?;
        inserted_raw_chunks = persist_stats.inserted_raw_chunks;
        inserted_events = persist_stats.inserted_events;
        parse_warnings = lossy_report
            .warnings
            .into_iter()
            .map(|warning| warning.message)
            .collect();
    }

    let updated_checkpoint = LogCheckpointRecord {
        log_path: path_string.clone(),
        session_id: session_id.clone(),
        byte_offset: current_offset,
        source_fingerprint,
        pending_fragment: next_pending_fragment.clone(),
        last_sequence: previous_sequence + sequence_advance,
    };
    store
        .upsert_log_checkpoint(&updated_checkpoint)
        .map_err(|error| format!("failed to persist log checkpoint: {error}"))?;

    Ok(LiveLogWatchSummary {
        log_path: path_string,
        session_id,
        source_kind: ImportSourceKind::LiveWatch.label().to_owned(),
        starting_offset,
        ending_offset: current_offset,
        inserted_raw_chunks,
        inserted_events,
        parse_warnings,
        unknown_events,
        rotation_detected,
        truncation_detected,
        pending_fragment_bytes: next_pending_fragment.as_bytes().len(),
    })
}

fn collect_log_files(roots: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut collected = BTreeSet::new();
    for root in roots {
        if root.is_file() {
            if is_log_file(root) {
                collected.insert(root.to_path_buf());
            }
            continue;
        }

        if root.is_dir() {
            collect_log_files_from_dir(root, &mut collected)?;
        }
    }

    Ok(collected.into_iter().collect())
}

fn collect_log_files_from_dir(dir: &Path, collected: &mut BTreeSet<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("failed to read directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_log_files_from_dir(&path, collected)?;
        } else if is_log_file(&path) {
            collected.insert(path);
        }
    }
    Ok(())
}

fn is_log_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("log"))
        .unwrap_or(false)
}

fn build_import_session_id(platform_tag: &PlatformTag, content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{}-{:x}", platform_tag.label(), hasher.finalize())
}

fn build_live_watch_fingerprint(content: &[u8]) -> String {
    let limit = content.len().min(4096);
    format!("{}:{}", limit, sha256_bytes(&content[..limit]))
}

fn fingerprint_matches(expected: &str, content: &[u8]) -> bool {
    let Some((length, hash)) = expected.split_once(':') else {
        return false;
    };
    let Ok(length) = length.parse::<usize>() else {
        return false;
    };
    if content.len() < length {
        return false;
    }
    sha256_bytes(&content[..length]) == hash
}

fn sha256_bytes(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

fn build_live_watch_session_id(log_path: &Path, source_fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(log_path.to_string_lossy().as_bytes());
    hasher.update(source_fingerprint.as_bytes());
    format!("desktop-live-{:x}", hasher.finalize())
}

fn split_committed_text(input: &str) -> (String, String) {
    if let Some(index) = input.rfind('\n') {
        let committed = input[..=index].to_owned();
        let pending = input[index + 1..].to_owned();
        (committed, pending)
    } else {
        (String::new(), input.to_owned())
    }
}

fn max_consumed_sequence(a: u64, b: u64) -> u64 {
    if a > b { a } else { b }
}

pub fn cli_usage() -> &'static str {
    "Usage:\n  mancutg-arenac bootstrap <log-path>\n  mancutg-arenac watch-log <log-path> [store-path]\n  mancutg-arenac import-ios-file <log-path> [store-path]\n  mancutg-arenac import-ios-folder <directory> [store-path]"
}

pub fn run_cli(args: &[String]) -> Result<String, String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Ok(cli_usage().to_owned());
    };

    match command {
        "--help" | "-h" | "help" => Ok(cli_usage().to_owned()),
        "bootstrap" => {
            let log_path = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let result = bootstrap_local_companion("desktop-bootstrap", log_path)?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize bootstrap result: {error}"))
        }
        "watch-log" => {
            let log_path = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let result = watch_live_log_once(log_path, args.get(2).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize watch result: {error}"))
        }
        "import-ios-file" => {
            let log_path = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let store = open_store(args.get(2).map(String::as_str))?;
            let result = import_ios_logs(
                &store,
                ImportSourceKind::DragAndDrop,
                vec![PathBuf::from(log_path)],
            )?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize import result: {error}"))
        }
        "import-ios-folder" => {
            let directory = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let store = open_store(args.get(2).map(String::as_str))?;
            let result = import_ios_logs(
                &store,
                ImportSourceKind::FolderImport,
                vec![PathBuf::from(directory)],
            )?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize import result: {error}"))
        }
        _ => Err(cli_usage().to_owned()),
    }
}
