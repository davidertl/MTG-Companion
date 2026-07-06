#[cfg(feature = "gui")]
pub mod commands;

use core_domain::{
    CollectionSnapshot, DraftPick, EventType, ImportSourceKind, InventorySnapshot, LogSession,
    MatchRecord, NormalizedEvent, ParseReport, PlatformTag,
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
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
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

/// Snapshot of the continuous live watcher, returned by the `watcher_status`
/// command. Always carries `default_log_path` (from
/// [`default_arena_log_path`]) so the UI can surface a real Arena log path
/// even before a watcher has been started.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStatus {
    pub running: bool,
    pub log_path: Option<String>,
    pub default_log_path: Option<String>,
    pub ingest_count: usize,
    pub total_inserted_events: usize,
    pub total_inserted_raw_chunks: usize,
    pub last_error: Option<String>,
}

impl WatcherStatus {
    fn default_log_path_string() -> Option<String> {
        default_arena_log_path().map(|path| path.to_string_lossy().into_owned())
    }

    /// Status when no watcher is running.
    pub fn idle() -> Self {
        Self {
            running: false,
            log_path: None,
            default_log_path: Self::default_log_path_string(),
            ingest_count: 0,
            total_inserted_events: 0,
            total_inserted_raw_chunks: 0,
            last_error: None,
        }
    }

    fn running(log_path: &Path) -> Self {
        Self {
            running: true,
            log_path: Some(log_path.to_string_lossy().into_owned()),
            default_log_path: Self::default_log_path_string(),
            ingest_count: 0,
            total_inserted_events: 0,
            total_inserted_raw_chunks: 0,
            last_error: None,
        }
    }

    fn record_ingest(&mut self, summary: &LiveLogWatchSummary) {
        self.ingest_count += 1;
        self.total_inserted_events += summary.inserted_events;
        self.total_inserted_raw_chunks += summary.inserted_raw_chunks;
    }
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
}

impl Default for ArenaSettings {
    fn default() -> Self {
        Self {
            privacy: ArenaPrivacySettings::default(),
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
pub struct CardDbImportSummary {
    pub card_db_path: String,
    pub bulk_path: String,
    pub imported_cards: usize,
    pub skipped_entries: usize,
    pub card_count: usize,
    pub with_arena_id_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDbStatusSummary {
    pub card_db_path: String,
    pub card_db_exists: bool,
    pub card_count: usize,
    pub with_arena_id_count: usize,
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

/// A single normalized event belonging to one match, as surfaced to the
/// desktop match-detail timeline. The structured payload is re-serialized to a
/// JSON string so the UI can render nested gameplay payloads without a second
/// Rust-side type per event shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchEventSummary {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub event_type: String,
    pub payload_json: String,
}

/// Read model backing the `inspect_match` command: every stored event whose
/// payload carries the requested `match_id`, in stored order. Follows the same
/// `match_id`-in-payload convention as [`core_store::EventStore::load_match_history`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchInspection {
    pub match_id: String,
    pub events: Vec<MatchEventSummary>,
}

/// Read model backing the `load_game_timeline` command: the reconstructed
/// per-turn [`core_gamestate::GameTimeline`] for one match. Built by folding the
/// match's stored gameplay events through the pure `core-gamestate` engine — a
/// read-only projection, no I/O beyond the event read (append-only invariant
/// untouched).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchTimeline {
    pub match_id: String,
    pub timeline: core_gamestate::GameTimeline,
}

/// Read model backing the `analyze_match` command: the deterministic rule-check
/// findings raised for one match. Built by folding the match's stored gameplay
/// events into a timeline and running the pure `core-analysis` engine against
/// the sibling `cards.sqlite` card DB (when present). Each finding is also
/// persisted as an append-only `analysis.finding.raised` event so sync,
/// projections, and review reuse the existing event machinery.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchAnalysis {
    pub match_id: String,
    /// Whether a card DB was available; several checks stay silent without one.
    pub card_db_available: bool,
    /// Findings persisted this run (0 when re-analyzing yields identical events,
    /// since the event store deduplicates append-only rows).
    pub persisted_events: usize,
    pub findings: Vec<core_analysis::Finding>,
}

/// Outcome of a [`sync_now`] pass, surfaced to the settings UI.
///
/// `attempted` is `false` (and every counter zero) when sync consent is off —
/// the hard gate that guarantees zero network calls for offline/unconsented
/// users. `backend_url` is echoed back so the UI can show where events go.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub sync_enabled: bool,
    pub attempted: bool,
    pub batches_sent: usize,
    pub events_synced: usize,
    pub pending_remaining: usize,
    pub backend_url: String,
    pub last_error: Option<String>,
}

/// Default backend base URL for sync; overridable via `MANCUTG_BACKEND_URL`
/// (e.g. to point at a non-local backend). The `/events` path is appended when
/// posting. Matches the `npm run api:start` port (8787).
const DEFAULT_BACKEND_BASE_URL: &str = "http://127.0.0.1:8787";

fn backend_events_url() -> String {
    let base = env::var("MANCUTG_BACKEND_URL")
        .unwrap_or_else(|_| DEFAULT_BACKEND_BASE_URL.to_owned());
    format!("{}/events", base.trim_end_matches('/'))
}

fn resolve_store_path(optional_store_path: Option<&str>) -> Result<PathBuf, String> {
    match optional_store_path {
        Some(path) => Ok(PathBuf::from(path)),
        None => default_store_path(),
    }
}

fn default_store_path() -> Result<PathBuf, String> {
    env::current_dir()
        .map(|cwd| cwd.join("mancutg-arenac.sqlite3"))
        .map_err(|error| format!("failed to determine current directory: {error}"))
}

/// The card database is a sibling file of the event store
/// (`default_store_path()`), populated exclusively via the offline
/// `import-card-db` CLI command — never by runtime network calls.
fn default_card_db_path() -> Result<PathBuf, String> {
    Ok(default_store_path()?.with_file_name("cards.sqlite"))
}

fn resolve_card_db_path(optional_card_db_path: Option<&str>) -> Result<PathBuf, String> {
    match optional_card_db_path {
        Some(path) => Ok(PathBuf::from(path)),
        None => default_card_db_path(),
    }
}

/// Best-effort detection of the default MTG Arena `Player.log` location for
/// the current operating system. Returns `None` on platforms where the
/// location is unknown (e.g. Linux dev/CI hosts) or when the required
/// environment variables are absent. This is surfaced through
/// [`watcher_status`] so the Setup view can display a real log path instead
/// of an always-"Pending" placeholder.
pub fn default_arena_log_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        // %AppData% points at ...\AppData\Roaming; the Arena log lives in the
        // sibling LocalLow tree, hence the `..` hop.
        env::var_os("APPDATA").map(|appdata| {
            PathBuf::from(appdata)
                .join("..")
                .join("LocalLow")
                .join("Wizards Of The Coast")
                .join("MTGA")
                .join("Player.log")
        })
    }

    #[cfg(target_os = "macos")]
    {
        env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join("Wizards Of The Coast")
                .join("MTGA")
                .join("Player.log")
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
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

pub fn import_ios_file_at_path(log_path: &str) -> Result<OfflineLogImportSummary, String> {
    let store = open_store(None)?;
    let summary = import_ios_logs(
        &store,
        ImportSourceKind::DragAndDrop,
        vec![PathBuf::from(log_path)],
    )?;
    // Enqueue-on-ingest: mirror to the sync outbox when consent is on
    // (best-effort — a sync-outbox hiccup must never fail the import itself).
    let _ = enqueue_ingested_events(None, None);
    Ok(summary)
}

pub fn import_ios_folder_at_path(directory: &str) -> Result<OfflineLogImportSummary, String> {
    let store = open_store(None)?;
    let summary = import_ios_logs(
        &store,
        ImportSourceKind::FolderImport,
        vec![PathBuf::from(directory)],
    )?;
    let _ = enqueue_ingested_events(None, None);
    Ok(summary)
}

pub fn inspect_local_store(optional_store_path: Option<&str>) -> Result<LocalStoreSummary, String> {
    let store = open_store(optional_store_path)?;
    build_local_store_summary(&store)
}

/// Returns every stored event whose payload carries the given `match_id`, in
/// stored (`rowid`) order, backing the desktop match-detail timeline. Uses the
/// same `match_id`-in-payload grouping convention as
/// [`core_store::EventStore::load_match_history`], so the events surfaced here
/// are exactly those the match list summarizes.
pub fn inspect_match(
    match_id: &str,
    optional_store_path: Option<&str>,
) -> Result<MatchInspection, String> {
    let store = open_store(optional_store_path)?;
    build_match_inspection(&store, match_id)
}

/// Reconstructs the per-turn game timeline for `match_id` by folding the match's
/// stored gameplay events through the pure `core-gamestate` engine. Uses the
/// same `match_id`-in-payload grouping convention as [`inspect_match`], so the
/// timeline covers exactly the events the match-detail view lists. Read-only.
pub fn load_game_timeline(
    match_id: &str,
    optional_store_path: Option<&str>,
) -> Result<MatchTimeline, String> {
    let store = open_store(optional_store_path)?;
    build_game_timeline(&store, match_id)
}

/// Runs the deterministic rules checker over `match_id`: folds the match's
/// stored gameplay events into a timeline, opens the sibling `cards.sqlite` card
/// DB when it exists (passing `None` otherwise — the engine is pure and
/// carddb-optional), runs `core-analysis`, and persists each finding as an
/// append-only `analysis.finding.raised` event before returning them. Re-running
/// is idempotent: identical findings deduplicate against the event store's
/// append-only unique constraint.
pub fn analyze_match(
    match_id: &str,
    optional_store_path: Option<&str>,
) -> Result<MatchAnalysis, String> {
    let store = open_store(optional_store_path)?;
    let card_db_path = default_card_db_path()?;
    let carddb = if card_db_path.exists() {
        Some(core_carddb::CardDb::open(&card_db_path).map_err(|error| {
            format!(
                "failed to open card database {}: {error}",
                card_db_path.display()
            )
        })?)
    } else {
        None
    };
    build_match_analysis(&store, match_id, carddb.as_ref())
}

/// Writes `contents` verbatim to `path`. Used by the desktop export flow after
/// the user has picked a destination via the native save dialog; the write
/// target is therefore an explicit, user-chosen path. Returns the written path.
pub fn write_export_file(path: &str, contents: &str) -> Result<String, String> {
    fs::write(path, contents)
        .map_err(|error| format!("failed to write export file {path}: {error}"))?;
    Ok(path.to_owned())
}

/// Converts a stored event into a sync-outbox input. The stable
/// `event_id` (`"<session_id>:<sequence>"`) makes enqueue idempotent and lets
/// the backend deduplicate.
fn event_to_outbox_input(event: &NormalizedEvent) -> core_sync::OutboxEventInput {
    core_sync::OutboxEventInput {
        session_id: event.session_id.clone(),
        sequence: event.sequence,
        event_type: event.event_type.label().to_owned(),
        occurred_at: event.timestamp.clone(),
        payload: event.payload.clone(),
    }
}

/// Enqueue-on-ingest hook. When sync consent is on, mirrors the persistent
/// store's events into the sync outbox (idempotent `INSERT OR IGNORE`), so a
/// later [`sync_now`] has everything to drain. A no-op when sync is disabled,
/// so ingest paths are unchanged for offline users. Returns the number of
/// newly enqueued rows.
///
/// Raw log chunks are deliberately never enqueued — only normalized events —
/// which upholds the "events/normalized only" (rawUploadEnabled off) posture.
pub fn enqueue_ingested_events(
    optional_store_path: Option<&str>,
    optional_settings_path: Option<&str>,
) -> Result<usize, String> {
    let settings = load_arena_settings(optional_settings_path)?;
    if !settings.privacy.sync_enabled {
        return Ok(0);
    }
    let store_path = resolve_store_path(optional_store_path)?;
    let store = EventStore::open(&store_path)
        .map_err(|error| format!("failed to open store for outbox enqueue: {error}"))?;
    let events = store
        .load_events()
        .map_err(|error| format!("failed to load events for outbox enqueue: {error}"))?;
    let outbox = core_sync::Outbox::open(&store_path)
        .map_err(|error| format!("failed to open sync outbox: {error}"))?;
    let inputs: Vec<_> = events.iter().map(event_to_outbox_input).collect();
    outbox
        .enqueue(&inputs)
        .map_err(|error| format!("failed to enqueue events for sync: {error}"))
}

/// Drains the sync outbox to the backend `/events` endpoint, hard-gated on
/// sync consent.
///
/// When `PrivacySettings.sync_enabled` is false this returns immediately with
/// `attempted: false` and makes **zero** network calls — no HTTP client is
/// even constructed. When enabled, it first mirrors the store into the outbox
/// (idempotent) and then drains pending batches with exponential backoff and
/// one deterministic `idempotencyKey` per batch, so retries never duplicate
/// server rows. Only normalized events are sent; raw chunks are never uploaded.
pub fn sync_now(
    optional_store_path: Option<&str>,
    optional_settings_path: Option<&str>,
) -> Result<SyncOutcome, String> {
    let settings = load_arena_settings(optional_settings_path)?;
    let backend_url = backend_events_url();

    // Hard consent gate: nothing leaves the device when sync is off.
    if !settings.privacy.sync_enabled {
        return Ok(SyncOutcome {
            sync_enabled: false,
            attempted: false,
            batches_sent: 0,
            events_synced: 0,
            pending_remaining: 0,
            backend_url,
            last_error: None,
        });
    }

    let store_path = resolve_store_path(optional_store_path)?;
    let store = EventStore::open(&store_path)
        .map_err(|error| format!("failed to open store for sync: {error}"))?;
    let events = store
        .load_events()
        .map_err(|error| format!("failed to load events for sync: {error}"))?;
    let outbox = core_sync::Outbox::open(&store_path)
        .map_err(|error| format!("failed to open sync outbox: {error}"))?;
    let inputs: Vec<_> = events.iter().map(event_to_outbox_input).collect();
    outbox
        .enqueue(&inputs)
        .map_err(|error| format!("failed to enqueue events for sync: {error}"))?;

    let config = core_sync::DrainConfig::default();
    let report = core_sync::sync_outbox(
        &outbox,
        settings.privacy.sync_enabled,
        |_batch: &core_sync::SyncBatch, body: &str| post_batch_via_http(&backend_url, body),
        &config,
    )
    .map_err(|error| format!("failed to drain sync outbox: {error}"))?;

    let pending_remaining = outbox
        .pending_count()
        .map_err(|error| format!("failed to read outbox pending count: {error}"))?;

    Ok(SyncOutcome {
        sync_enabled: true,
        attempted: report.attempted,
        batches_sent: report.batches_sent,
        events_synced: report.events_synced,
        pending_remaining,
        backend_url,
        last_error: report.last_error,
    })
}

/// Posts a serialized batch to the backend `/events` endpoint using a minimal
/// HTTP client. 5xx / network errors are retryable (the outbox retries with
/// backoff); 4xx is permanent (a malformed batch is not retried).
fn post_batch_via_http(url: &str, body: &str) -> core_sync::TransportOutcome {
    match ureq::post(url)
        .set("Content-Type", "application/json")
        .send_string(body)
    {
        Ok(_response) => core_sync::TransportOutcome::Success,
        Err(ureq::Error::Status(code, _response)) => {
            if code >= 500 {
                core_sync::TransportOutcome::Retryable(format!("backend returned status {code}"))
            } else {
                core_sync::TransportOutcome::Permanent(format!(
                    "backend rejected batch with status {code}"
                ))
            }
        }
        Err(ureq::Error::Transport(transport)) => {
            core_sync::TransportOutcome::Retryable(format!("transport error: {transport}"))
        }
    }
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

/// Default poll interval for the follow loop when no filesystem event
/// arrives. `notify` events short-circuit the wait, so this is only the
/// worst-case latency (matching the plan's "~2s poll fallback").
pub const DEFAULT_FOLLOW_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Cooperative stop signal shared between a [`LiveWatcherHandle`] and its
/// background follow thread. Cheap to clone (an `Arc<AtomicBool>` inside).
#[derive(Clone, Default)]
pub struct WatcherControl {
    stop: Arc<AtomicBool>,
}

impl WatcherControl {
    pub fn new() -> Self {
        Self::default()
    }

    /// Requests the follow loop to terminate. Idempotent: calling it more
    /// than once is harmless.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
}

/// Owns a running follow thread plus its stop signal and live status. Drop
/// or [`LiveWatcherHandle::stop`] signals the thread to wind down; the loop's
/// poll interval bounds how quickly it observes the request.
pub struct LiveWatcherHandle {
    control: WatcherControl,
    join: Option<JoinHandle<()>>,
    status: Arc<Mutex<WatcherStatus>>,
}

impl LiveWatcherHandle {
    /// Signals the follow loop to stop. Idempotent.
    pub fn stop(&self) {
        self.control.stop();
    }

    /// Blocks until the follow thread has fully terminated. Consumes the
    /// handle so it cannot be joined twice.
    pub fn join(mut self) {
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }

    /// Returns a snapshot of the current watcher status.
    pub fn status(&self) -> WatcherStatus {
        self.status
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| WatcherStatus::idle())
    }

    /// True while the follow thread is still alive and has not been stopped.
    pub fn is_running(&self) -> bool {
        !self.control.is_stopped()
            && self
                .join
                .as_ref()
                .map(|join| !join.is_finished())
                .unwrap_or(false)
    }
}

impl Drop for LiveWatcherHandle {
    fn drop(&mut self) {
        self.control.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Builds a `notify` watcher on the parent directory of `log_path` so that
/// file creation, appends, and rotation all wake the follow loop. Returns
/// `None` (falling back to pure polling) if a watcher cannot be established —
/// e.g. the parent directory does not exist yet, or the platform backend is
/// unavailable.
fn build_log_notify_watcher(
    log_path: &Path,
    tx: Sender<()>,
) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher as _;

    let parent = log_path.parent().filter(|dir| !dir.as_os_str().is_empty())?;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .ok()?;
    watcher
        .watch(parent, notify::RecursiveMode::NonRecursive)
        .ok()?;
    Some(watcher)
}

/// Library-testable continuous follow loop over a single `Player.log`, built
/// on the proven [`watch_live_log_once_with_store`] incremental core. Blocks
/// the calling thread until `control` is stopped, invoking `on_ingest` after
/// every ingest that actually produced new data.
///
/// A missing log file is tolerated (the loop simply waits); rotation and
/// truncation are handled by the underlying incremental core. Transient read
/// errors never terminate the loop.
pub fn watch_live_log_follow_with_store(
    store: &EventStore,
    log_path: impl AsRef<Path>,
    control: &WatcherControl,
    poll_interval: Duration,
    mut on_ingest: impl FnMut(&LiveLogWatchSummary),
) -> Result<(), String> {
    let log_path = log_path.as_ref();
    let (tx, rx) = mpsc::channel::<()>();
    // The watcher owns a cloned sender; keeping the original alive here means
    // the channel never disconnects, so `recv_timeout` always waits the full
    // poll interval even when no `notify` backend is available.
    let _keepalive_tx = tx.clone();
    let _watcher = build_log_notify_watcher(log_path, tx);

    loop {
        if control.is_stopped() {
            break;
        }

        if log_path.exists() {
            match watch_live_log_once_with_store(store, log_path) {
                Ok(summary) => {
                    if summary.inserted_events > 0 || summary.inserted_raw_chunks > 0 {
                        on_ingest(&summary);
                    }
                }
                // Tolerate transient errors (e.g. the file vanishing between
                // the existence check and the read during a rotation) — the
                // follow loop must never crash on malformed or racing input.
                Err(_error) => {}
            }
        }

        if control.is_stopped() {
            break;
        }

        match rx.recv_timeout(poll_interval) {
            Ok(()) => {
                // Coalesce any bursts of filesystem events into one pass.
                while rx.try_recv().is_ok() {}
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                thread::sleep(poll_interval);
            }
        }
    }

    Ok(())
}

/// Spawns a background thread that follows `log_path` continuously, returning
/// a [`LiveWatcherHandle`] with start/stop control and live status. The thread
/// opens its own [`EventStore`] (an `EventStore` connection is `Send` but not
/// `Sync`, so it is owned by the follow thread). `on_ingest` runs on the
/// follow thread after each ingest that produced new data.
pub fn watch_live_log_follow(
    log_path: PathBuf,
    optional_store_path: Option<String>,
    poll_interval: Duration,
    mut on_ingest: impl FnMut(&LiveLogWatchSummary) + Send + 'static,
) -> Result<LiveWatcherHandle, String> {
    let control = WatcherControl::new();
    let status = Arc::new(Mutex::new(WatcherStatus::running(&log_path)));
    let thread_control = control.clone();
    let thread_status = Arc::clone(&status);

    let join = thread::Builder::new()
        .name("mancutg-live-watcher".to_owned())
        .spawn(move || {
            let store = match open_store(optional_store_path.as_deref()) {
                Ok(store) => store,
                Err(error) => {
                    if let Ok(mut guard) = thread_status.lock() {
                        guard.running = false;
                        guard.last_error = Some(error);
                    }
                    return;
                }
            };

            let loop_status = Arc::clone(&thread_status);
            let result = watch_live_log_follow_with_store(
                &store,
                &log_path,
                &thread_control,
                poll_interval,
                |summary| {
                    if let Ok(mut guard) = loop_status.lock() {
                        guard.record_ingest(summary);
                    }
                    on_ingest(summary);
                },
            );

            if let Ok(mut guard) = thread_status.lock() {
                guard.running = false;
                if let Err(error) = result {
                    guard.last_error = Some(error);
                }
            }
        })
        .map_err(|error| format!("failed to spawn live watcher thread: {error}"))?;

    Ok(LiveWatcherHandle {
        control,
        join: Some(join),
        status,
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

fn build_match_inspection(
    store: &EventStore,
    match_id: &str,
) -> Result<MatchInspection, String> {
    let events = store
        .load_events()
        .map_err(|error| format!("failed to load events: {error}"))?;

    let mut match_events = Vec::new();
    for event in events {
        if core_domain::payload_value(&event.payload, "match_id").as_deref() != Some(match_id) {
            continue;
        }
        let payload_json = serde_json::to_string(&event.payload)
            .unwrap_or_else(|_| "{}".to_owned());
        match_events.push(MatchEventSummary {
            session_id: event.session_id,
            sequence: event.sequence,
            timestamp: event.timestamp,
            event_type: event.event_type.label().to_owned(),
            payload_json,
        });
    }

    Ok(MatchInspection {
        match_id: match_id.to_owned(),
        events: match_events,
    })
}

/// Loads the match's events and folds the ones belonging to `match_id` into a
/// [`core_gamestate::GameTimeline`]. Events without a `match_id` in payload are
/// skipped, mirroring [`build_match_inspection`]; the fold itself is pure and
/// gap-tolerant (partial logs yield `Completeness::Partial`, never an error).
fn build_game_timeline(store: &EventStore, match_id: &str) -> Result<MatchTimeline, String> {
    let events = store
        .load_events()
        .map_err(|error| format!("failed to load events: {error}"))?;

    let match_events: Vec<_> = events
        .into_iter()
        .filter(|event| {
            core_domain::payload_value(&event.payload, "match_id").as_deref() == Some(match_id)
        })
        .collect();

    Ok(MatchTimeline {
        match_id: match_id.to_owned(),
        timeline: core_gamestate::GameTimeline::from_events(&match_events),
    })
}

/// Folds the match's stored gameplay events into a timeline, runs the pure
/// `core-analysis` engine (with the given optional card DB), persists each
/// finding as an append-only `analysis.finding.raised` event, and returns the
/// findings. Read side mirrors [`build_game_timeline`]; the write side is a
/// pure append (no event mutation), preserving the append-only invariant.
fn build_match_analysis(
    store: &EventStore,
    match_id: &str,
    carddb: Option<&core_carddb::CardDb>,
) -> Result<MatchAnalysis, String> {
    let events = store
        .load_events()
        .map_err(|error| format!("failed to load events: {error}"))?;
    let match_events: Vec<_> = events
        .into_iter()
        .filter(|event| {
            core_domain::payload_value(&event.payload, "match_id").as_deref() == Some(match_id)
        })
        .collect();

    let timeline = core_gamestate::GameTimeline::from_events(&match_events);
    let findings = core_analysis::analyze_with_game_key(&timeline, carddb, match_id);

    let report = build_findings_report(match_id, &findings)?;
    let persist_stats = store
        .apply_report(&report)
        .map_err(|error| format!("failed to persist analysis findings: {error}"))?;

    Ok(MatchAnalysis {
        match_id: match_id.to_owned(),
        card_db_available: carddb.is_some(),
        persisted_events: persist_stats.inserted_events,
        findings,
    })
}

/// Builds an append-only [`ParseReport`] of `analysis.finding.raised` events —
/// one per finding — for a match. The `match_id` is added to each finding's
/// payload so the events group with the rest of the match; the stable
/// `session_id`/`sequence` pairing plus the store's full-row unique constraint
/// make re-persisting identical findings idempotent.
fn build_findings_report(
    match_id: &str,
    findings: &[core_analysis::Finding],
) -> Result<ParseReport, String> {
    let session_id = format!("analysis-{match_id}");
    let mut events = Vec::with_capacity(findings.len());
    for (index, finding) in findings.iter().enumerate() {
        let mut payload = serde_json::to_value(finding)
            .map_err(|error| format!("failed to serialize finding: {error}"))?;
        if let serde_json::Value::Object(map) = &mut payload {
            map.insert(
                "match_id".to_owned(),
                serde_json::Value::String(match_id.to_owned()),
            );
        }
        events.push(NormalizedEvent {
            session_id: session_id.clone(),
            sequence: index as u64,
            timestamp: String::new(),
            event_type: EventType::from_label("analysis.finding.raised"),
            payload,
        });
    }

    Ok(ParseReport {
        raw_chunks: Vec::new(),
        events,
        next_offset: 0,
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

/// Imports a manually downloaded Scryfall bulk-data file ("Oracle Cards",
/// see <https://scryfall.com/docs/api/bulk-data>) into the local card
/// database beside the event store. Fully offline: reads only the given
/// file, streams it (never loads the ~2GB bulk file into memory), and is
/// idempotent on re-import.
pub fn import_card_db(
    bulk_path: &str,
    optional_card_db_path: Option<&str>,
) -> Result<CardDbImportSummary, String> {
    let card_db_path = resolve_card_db_path(optional_card_db_path)?;
    let bulk_file = fs::File::open(bulk_path)
        .map_err(|error| format!("failed to open Scryfall bulk file {bulk_path}: {error}"))?;
    let card_db = core_carddb::CardDb::open(&card_db_path).map_err(|error| {
        format!(
            "failed to open card database {}: {error}",
            card_db_path.display()
        )
    })?;
    let stats = card_db
        .import_scryfall_bulk(bulk_file)
        .map_err(|error| format!("failed to import Scryfall bulk file {bulk_path}: {error}"))?;
    let status = card_db
        .status()
        .map_err(|error| format!("failed to read card database status: {error}"))?;

    Ok(CardDbImportSummary {
        card_db_path: card_db_path.to_string_lossy().into_owned(),
        bulk_path: bulk_path.to_owned(),
        imported_cards: stats.imported_cards,
        skipped_entries: stats.skipped_entries,
        card_count: status.card_count,
        with_arena_id_count: status.with_arena_id_count,
    })
}

pub fn card_db_status(
    optional_card_db_path: Option<&str>,
) -> Result<CardDbStatusSummary, String> {
    let card_db_path = resolve_card_db_path(optional_card_db_path)?;
    if !card_db_path.exists() {
        return Ok(CardDbStatusSummary {
            card_db_path: card_db_path.to_string_lossy().into_owned(),
            card_db_exists: false,
            card_count: 0,
            with_arena_id_count: 0,
        });
    }

    let card_db = core_carddb::CardDb::open(&card_db_path).map_err(|error| {
        format!(
            "failed to open card database {}: {error}",
            card_db_path.display()
        )
    })?;
    let status = card_db
        .status()
        .map_err(|error| format!("failed to read card database status: {error}"))?;

    Ok(CardDbStatusSummary {
        card_db_path: card_db_path.to_string_lossy().into_owned(),
        card_db_exists: true,
        card_count: status.card_count,
        with_arena_id_count: status.with_arena_id_count,
    })
}

pub fn cli_usage() -> &'static str {
    "Usage:\n  mancutg-arenac bootstrap <log-path>\n  mancutg-arenac watch-log <log-path> [store-path] [--follow]\n  mancutg-arenac sync-now [store-path] [settings-path]\n  mancutg-arenac inspect-store [store-path]\n  mancutg-arenac reprocess-session <session-id> [store-path]\n  mancutg-arenac export-backup [store-path]\n  mancutg-arenac show-settings [settings-path]\n  mancutg-arenac set-consent <updates|sync|telemetry|archidekt> <on|off> [settings-path]\n  mancutg-arenac reset-settings [settings-path]\n  mancutg-arenac wipe-local-data [store-path] [settings-path]\n  mancutg-arenac import-ios-file <log-path> [store-path]\n  mancutg-arenac import-ios-folder <directory> [store-path]\n  mancutg-arenac import-card-db <scryfall-bulk.json> [card-db-path]\n  mancutg-arenac card-db-status [card-db-path]\n\nCard database:\n  Download the Scryfall \"Oracle Cards\" bulk data file manually from\n  https://scryfall.com/docs/api/bulk-data and import it with import-card-db.\n  The import runs fully offline (no network calls are ever made) and stores\n  the card database beside the event store as cards.sqlite by default."
}

/// Runs `watch-log --follow`: a continuous tail of the Arena log that prints
/// each ingest summary as a JSON line and blocks until the process is
/// interrupted (Ctrl-C).
fn run_watch_log_follow_cli(log_path: &str, store_path: Option<&str>) -> Result<String, String> {
    println!("Following {log_path} (press Ctrl-C to stop)...");
    let store_path_owned = store_path.map(|path| path.to_owned());
    let enqueue_store_path = store_path_owned.clone();
    let handle = watch_live_log_follow(
        PathBuf::from(log_path),
        store_path_owned,
        DEFAULT_FOLLOW_POLL_INTERVAL,
        move |summary| {
            // Enqueue-on-ingest when sync consent is on (best-effort).
            let _ = enqueue_ingested_events(enqueue_store_path.as_deref(), None);
            match serde_json::to_string(summary) {
                Ok(json) => println!("{json}"),
                Err(error) => eprintln!("failed to serialize watch summary: {error}"),
            }
        },
    )?;
    // Blocks until the follow thread exits; Ctrl-C terminates the process.
    handle.join();
    Ok(String::new())
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
            let mut positional = Vec::new();
            let mut follow = false;
            for arg in &args[1..] {
                if arg == "--follow" {
                    follow = true;
                } else {
                    positional.push(arg.as_str());
                }
            }
            let log_path = positional.first().ok_or_else(|| cli_usage().to_owned())?;
            let store_path = positional.get(1).copied();
            if follow {
                return run_watch_log_follow_cli(log_path, store_path);
            }
            let result = watch_live_log_once(log_path, store_path)?;
            // Enqueue-on-ingest when sync consent is on (best-effort).
            let _ = enqueue_ingested_events(store_path, None);
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize watch result: {error}"))
        }
        "sync-now" => {
            let result = sync_now(
                args.get(1).map(String::as_str),
                args.get(2).map(String::as_str),
            )?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize sync outcome: {error}"))
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
        "import-card-db" => {
            let bulk_path = args.get(1).ok_or_else(|| cli_usage().to_owned())?;
            let result = import_card_db(bulk_path, args.get(2).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize card db import summary: {error}"))
        }
        "card-db-status" => {
            let result = card_db_status(args.get(1).map(String::as_str))?;
            serde_json::to_string_pretty(&result)
                .map_err(|error| format!("failed to serialize card db status: {error}"))
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
