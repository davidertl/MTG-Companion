use core_domain::{
    CollectionSnapshot, DraftPick, EventType, ImportSourceKind, InventorySnapshot, LogSession,
    MatchRecord, PlatformTag,
};
use core_parser::parse_log_lossy;
use core_store::EventStore;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
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
