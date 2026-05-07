mod serve;

pub use serve::{
    default_player_log_path, parse_serve_args, run_serve, ServiceHandshake, DEFAULT_LOOPBACK_PORT,
};

use core_domain::{
    CollectionSnapshot, DraftPick, EventType, ImportSourceKind, InventorySnapshot, LogSession,
    MatchRecord, PlatformTag,
};
use core_parser::parse_log_lossy;
use core_store::{EventStore, IngestDiagnosticRecord, LogCheckpointRecord};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaPrivacySettings {
    pub telemetry_enabled: bool,
    pub sync_enabled: bool,
    pub allowed_purposes: Vec<String>,
}

impl Default for ArenaPrivacySettings {
    fn default() -> Self {
        Self {
            telemetry_enabled: false,
            sync_enabled: false,
            allowed_purposes: vec!["updates".to_owned()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaSettings {
    pub privacy: ArenaPrivacySettings,
    #[serde(default)]
    pub detailed_logs_acknowledged: bool,
}

impl Default for ArenaSettings {
    fn default() -> Self {
        Self {
            privacy: ArenaPrivacySettings::default(),
            detailed_logs_acknowledged: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDataRemovalSummary {
    pub removed_store_file: bool,
    pub removed_settings_file: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSessionSummary {
    pub session_id: String,
    pub platform_tag: String,
    pub source_kind: String,
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiagnosticSummary {
    pub session_id: String,
    pub source_path: String,
    pub diagnostic_kind: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReprocessSessionSummary {
    pub session_id: String,
    pub raw_chunk_count: usize,
    pub reparsed_event_count: usize,
    pub parse_warnings: Vec<String>,
    pub unknown_events: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupBundle {
    pub sessions: Vec<ImportedSessionSummary>,
    pub match_history: Vec<MatchRecord>,
    pub collection_snapshot: Option<CollectionSnapshot>,
    pub inventory_snapshot: Option<InventorySnapshot>,
    pub draft_picks: Vec<DraftPick>,
    pub unknown_events: Vec<String>,
    pub diagnostics: Vec<ImportDiagnosticSummary>,
    pub checkpoints: Vec<LogCheckpointRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreSummary {
    pub sessions: Vec<ImportedSessionSummary>,
    pub match_history: Vec<MatchRecord>,
    pub collection_snapshot: Option<CollectionSnapshot>,
    pub inventory_snapshot: Option<InventorySnapshot>,
    pub draft_picks: Vec<DraftPick>,
    pub unknown_events: Vec<String>,
    pub diagnostics: Vec<ImportDiagnosticSummary>,
    pub checkpoints: Vec<LogCheckpointRecord>,
}

fn default_store_path() -> Result<PathBuf, String> {
    env::current_dir()
        .map(|cwd| cwd.join("mancutg-arenac.sqlite3"))
        .map_err(|error| format!("failed to determine current directory: {error}"))
}

fn default_settings_path() -> Result<PathBuf, String> {
    env::current_dir()
        .map(|cwd| cwd.join("mancutg-arenac-settings.json"))
        .map_err(|error| format!("failed to determine current directory: {error}"))
}

fn open_store(optional_store_path: Option<&str>) -> Result<EventStore, String> {
    let store_path = match optional_store_path {
        Some(path) => PathBuf::from(path),
        None => default_store_path()?,
    };
    EventStore::open(&store_path).map_err(|error| format!("failed to open store {}: {error}", store_path.display()))
}

fn resolve_settings_path(optional_settings_path: Option<&str>) -> Result<PathBuf, String> {
    match optional_settings_path {
        Some(path) => Ok(PathBuf::from(path)),
        None => default_settings_path(),
    }
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
        imported_paths.push(session.source_path.clone());
        let diagnostics =
            build_ingest_diagnostics(&session_id, &session.source_path, &lossy_report);
        parse_warnings.extend(diagnostics.iter().map(|diagnostic| diagnostic.message.clone()));
        store
            .append_ingest_diagnostics(&diagnostics)
            .map_err(|error| format!("failed to persist import diagnostics: {error}"))?;
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

pub fn inspect_local_store(optional_store_path: Option<&str>) -> Result<LocalStoreSummary, String> {
    let store = open_store(optional_store_path)?;
    build_local_store_summary(&store)
}

pub fn reprocess_session(
    session_id: &str,
    optional_store_path: Option<&str>,
) -> Result<ReprocessSessionSummary, String> {
    let store = open_store(optional_store_path)?;
    let raw_chunks = store
        .load_raw_chunks_for_session(session_id)
        .map_err(|error| format!("failed to load raw chunks for session {session_id}: {error}"))?;

    if raw_chunks.is_empty() {
        return Err(format!("no raw chunks found for session {session_id}"));
    }

    let mut reconstructed = String::new();
    for (index, chunk) in raw_chunks.iter().enumerate() {
        if index > 0 {
            reconstructed.push('\n');
        }
        reconstructed.push_str(&chunk.raw_text);
    }

    let reparsed = parse_log_lossy(session_id, &reconstructed, 0);
    let unknown_events = reparsed
        .report
        .events
        .iter()
        .filter_map(|event| match &event.event_type {
            EventType::Unknown(label) => Some(label.clone()),
            _ => None,
        })
        .collect();

    Ok(ReprocessSessionSummary {
        session_id: session_id.to_owned(),
        raw_chunk_count: raw_chunks.len(),
        reparsed_event_count: reparsed.report.events.len(),
        parse_warnings: reparsed
            .warnings
            .into_iter()
            .map(|warning| warning.message)
            .collect(),
        unknown_events,
    })
}

pub fn export_backup_bundle(optional_store_path: Option<&str>) -> Result<BackupBundle, String> {
    let store = open_store(optional_store_path)?;
    let summary = build_local_store_summary(&store)?;
    Ok(BackupBundle {
        sessions: summary.sessions,
        match_history: summary.match_history,
        collection_snapshot: summary.collection_snapshot,
        inventory_snapshot: summary.inventory_snapshot,
        draft_picks: summary.draft_picks,
        unknown_events: summary.unknown_events,
        diagnostics: summary.diagnostics,
        checkpoints: summary.checkpoints,
    })
}

pub fn load_arena_settings(optional_settings_path: Option<&str>) -> Result<ArenaSettings, String> {
    let settings_path = resolve_settings_path(optional_settings_path)?;
    if !settings_path.exists() {
        return Ok(ArenaSettings::default());
    }

    let raw = fs::read_to_string(&settings_path)
        .map_err(|error| format!("failed to read settings file {}: {error}", settings_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(ArenaSettings::default());
    }
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse settings file {}: {error}", settings_path.display()))
}

pub fn save_arena_settings(
    settings: &ArenaSettings,
    optional_settings_path: Option<&str>,
) -> Result<PathBuf, String> {
    let settings_path = resolve_settings_path(optional_settings_path)?;
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;
    fs::write(&settings_path, serialized)
        .map_err(|error| format!("failed to write settings file {}: {error}", settings_path.display()))?;
    Ok(settings_path)
}

pub fn set_consent(
    purpose: &str,
    enabled: bool,
    optional_settings_path: Option<&str>,
) -> Result<ArenaSettings, String> {
    let mut settings = load_arena_settings(optional_settings_path)?;

    match purpose {
        "telemetry" => {
            settings.privacy.telemetry_enabled = enabled;
            update_allowed_purpose(&mut settings.privacy.allowed_purposes, "telemetry", enabled);
        }
        "sync" => {
            settings.privacy.sync_enabled = enabled;
            update_allowed_purpose(&mut settings.privacy.allowed_purposes, "sync", enabled);
        }
        "archidekt" => {
            update_allowed_purpose(&mut settings.privacy.allowed_purposes, "archidekt", enabled);
        }
        "updates" => {
            update_allowed_purpose(&mut settings.privacy.allowed_purposes, "updates", enabled);
        }
        other => {
            return Err(format!("unknown consent purpose: {other}"));
        }
    }

    if !settings.privacy.allowed_purposes.iter().any(|purpose| purpose == "updates") {
        settings.privacy.allowed_purposes.push("updates".to_owned());
    }
    settings.privacy.allowed_purposes.sort();
    settings.privacy.allowed_purposes.dedup();

    save_arena_settings(&settings, optional_settings_path)?;
    Ok(settings)
}

pub fn set_detailed_logs_acknowledged(
    acknowledged: bool,
    optional_settings_path: Option<&str>,
) -> Result<ArenaSettings, String> {
    let mut settings = load_arena_settings(optional_settings_path)?;
    settings.detailed_logs_acknowledged = acknowledged;
    save_arena_settings(&settings, optional_settings_path)?;
    Ok(settings)
}

pub fn reset_arena_settings(optional_settings_path: Option<&str>) -> Result<ArenaSettings, String> {
    let settings = ArenaSettings::default();
    save_arena_settings(&settings, optional_settings_path)?;
    Ok(settings)
}

pub fn wipe_local_data(
    optional_store_path: Option<&str>,
    optional_settings_path: Option<&str>,
) -> Result<LocalDataRemovalSummary, String> {
    let store_path = match optional_store_path {
        Some(path) => PathBuf::from(path),
        None => default_store_path()?,
    };
    let settings_path = resolve_settings_path(optional_settings_path)?;

    let removed_store_file = if store_path.exists() {
        fs::remove_file(&store_path)
            .map_err(|error| format!("failed to remove store file {}: {error}", store_path.display()))?;
        true
    } else {
        false
    };

    let removed_settings_file = if settings_path.exists() {
        fs::remove_file(&settings_path).map_err(|error| {
            format!(
                "failed to remove settings file {}: {error}",
                settings_path.display()
            )
        })?;
        true
    } else {
        false
    };

    Ok(LocalDataRemovalSummary {
        removed_store_file,
        removed_settings_file,
    })
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
        let diagnostics = build_ingest_diagnostics(&session_id, &path_string, &lossy_report);
        parse_warnings = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.clone())
            .collect();
        store
            .append_ingest_diagnostics(&diagnostics)
            .map_err(|error| format!("failed to persist watch diagnostics: {error}"))?;
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

fn build_ingest_diagnostics(
    session_id: &str,
    source_path: &str,
    lossy_report: &core_parser::LossyParseResult,
) -> Vec<IngestDiagnosticRecord> {
    let mut diagnostics = lossy_report
        .warnings
        .iter()
        .map(|warning| IngestDiagnosticRecord {
            session_id: session_id.to_owned(),
            source_path: source_path.to_owned(),
            diagnostic_kind: "parse-warning".to_owned(),
            message: warning.message.clone(),
            detail_json: warning.line.clone(),
        })
        .collect::<Vec<_>>();

    diagnostics.extend(
        lossy_report
            .report
            .events
            .iter()
            .filter_map(|event| match &event.event_type {
                EventType::Unknown(label) => Some(IngestDiagnosticRecord {
                    session_id: session_id.to_owned(),
                    source_path: source_path.to_owned(),
                    diagnostic_kind: "unknown-event".to_owned(),
                    message: format!("unknown event label: {label}"),
                    detail_json: serde_json::to_string(&event.payload)
                        .unwrap_or_else(|_| "{}".to_owned()),
                }),
                _ => None,
            }),
    );

    diagnostics
}

fn build_local_store_summary(store: &EventStore) -> Result<LocalStoreSummary, String> {
    let sessions = store
        .load_log_sessions()
        .map_err(|error| format!("failed to load sessions: {error}"))?
        .into_iter()
        .map(|session| ImportedSessionSummary {
            session_id: session.session_id,
            platform_tag: session.platform_tag.label().to_owned(),
            source_kind: session.source_kind.label().to_owned(),
            source_path: session.source_path,
        })
        .collect();

    let diagnostics = store
        .load_ingest_diagnostics()
        .map_err(|error| format!("failed to load diagnostics: {error}"))?
        .into_iter()
        .map(|diagnostic| ImportDiagnosticSummary {
            session_id: diagnostic.session_id,
            source_path: diagnostic.source_path,
            diagnostic_kind: diagnostic.diagnostic_kind,
            message: diagnostic.message,
        })
        .collect();

    Ok(LocalStoreSummary {
        sessions,
        match_history: store
            .load_match_history()
            .map_err(|error| format!("failed to load match history: {error}"))?,
        collection_snapshot: store
            .latest_collection_snapshot()
            .map_err(|error| format!("failed to load collection snapshot: {error}"))?,
        inventory_snapshot: store
            .latest_inventory_snapshot()
            .map_err(|error| format!("failed to load inventory snapshot: {error}"))?,
        draft_picks: store
            .load_draft_picks()
            .map_err(|error| format!("failed to load draft picks: {error}"))?,
        unknown_events: store
            .load_unknown_event_labels()
            .map_err(|error| format!("failed to load unknown events: {error}"))?,
        diagnostics,
        checkpoints: store
            .load_all_log_checkpoints()
            .map_err(|error| format!("failed to load checkpoints: {error}"))?,
    })
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

fn update_allowed_purpose(allowed_purposes: &mut Vec<String>, purpose: &str, enabled: bool) {
    if enabled {
        if !allowed_purposes.iter().any(|candidate| candidate == purpose) {
            allowed_purposes.push(purpose.to_owned());
        }
    } else {
        allowed_purposes.retain(|candidate| candidate != purpose);
    }
}

pub fn cli_usage() -> &'static str {
    "Usage:\n  mancutg-arenac serve [--data-dir <path>] [--port <port>]\n  mancutg-arenac bootstrap <log-path>\n  mancutg-arenac watch-log <log-path> [store-path]\n  mancutg-arenac inspect-store [store-path]\n  mancutg-arenac reprocess-session <session-id> [store-path]\n  mancutg-arenac export-backup [store-path]\n  mancutg-arenac show-settings [settings-path]\n  mancutg-arenac set-consent <updates|sync|telemetry|archidekt> <on|off> [settings-path]\n  mancutg-arenac reset-settings [settings-path]\n  mancutg-arenac wipe-local-data [store-path] [settings-path]\n  mancutg-arenac import-ios-file <log-path> [store-path]\n  mancutg-arenac import-ios-folder <directory> [store-path]"
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
        "inspect-store" => {
            let result = inspect_local_store(args.get(1).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize store summary: {error}"))
        }
        "reprocess-session" => {
            let session_id = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let result = reprocess_session(session_id, args.get(2).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize reprocess summary: {error}"))
        }
        "export-backup" => {
            let result = export_backup_bundle(args.get(1).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize backup bundle: {error}"))
        }
        "show-settings" => {
            let result = load_arena_settings(args.get(1).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize settings: {error}"))
        }
        "set-consent" => {
            let purpose = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let enabled = match args.get(2).map(String::as_str) {
                Some("on") => true,
                Some("off") => false,
                _ => return Err(cli_usage().to_owned()),
            };
            let result = set_consent(purpose, enabled, args.get(3).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize settings: {error}"))
        }
        "reset-settings" => {
            let result = reset_arena_settings(args.get(1).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize reset settings: {error}"))
        }
        "wipe-local-data" => {
            let result = wipe_local_data(
                args.get(1).map(String::as_str),
                args.get(2).map(String::as_str),
            )?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize wipe result: {error}"))
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
