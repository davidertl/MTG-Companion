use crate::{
    ArenaSettings, BackupBundle, CardDbStatusSummary, DesktopBootstrap, LiveLogWatchSummary,
    LiveWatcherHandle, LocalStoreSummary, MatchAnalysis, MatchInspection, MatchTimeline,
    OfflineLogImportSummary, SyncOutcome, WatcherStatus,
};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

/// Process-wide slot holding the single active live watcher (if any). Keeps
/// the watcher's lifetime independent of any one command invocation so
/// `start_watcher` / `stop_watcher` / `watcher_status` can share it.
fn watcher_slot() -> &'static Mutex<Option<LiveWatcherHandle>> {
    static WATCHER: OnceLock<Mutex<Option<LiveWatcherHandle>>> = OnceLock::new();
    WATCHER.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub fn bootstrap(log_path: String) -> Result<DesktopBootstrap, String> {
    crate::bootstrap_local_state(&log_path)
}

#[tauri::command]
pub fn watch_log(log_path: String) -> Result<LiveLogWatchSummary, String> {
    crate::watch_live_log_once(&log_path, None)
}

#[tauri::command]
pub fn inspect_store() -> Result<LocalStoreSummary, String> {
    crate::inspect_local_store(None)
}

#[tauri::command]
pub fn show_settings() -> Result<ArenaSettings, String> {
    crate::load_arena_settings(None)
}

#[tauri::command]
pub fn set_consent(purpose: String, enabled: bool) -> Result<ArenaSettings, String> {
    crate::set_consent(&purpose, enabled, None)
}

#[tauri::command]
pub fn import_ios_file(log_path: String) -> Result<OfflineLogImportSummary, String> {
    crate::import_ios_file_at_path(&log_path)
}

#[tauri::command]
pub fn import_ios_folder(directory: String) -> Result<OfflineLogImportSummary, String> {
    crate::import_ios_folder_at_path(&directory)
}

#[tauri::command]
pub fn export_backup() -> Result<BackupBundle, String> {
    crate::export_backup_bundle(None)
}

/// Returns every stored event belonging to `match_id`, in stored order, for
/// the desktop match-detail timeline (read-only projection over the event
/// store; append-only invariant untouched).
#[tauri::command]
pub fn inspect_match(match_id: String) -> Result<MatchInspection, String> {
    crate::inspect_match(&match_id, None)
}

/// Returns the reconstructed per-turn game timeline for `match_id`, folding the
/// match's stored gameplay events through the pure `core-gamestate` engine
/// (read-only projection; partial logs yield a `Partial` completeness marker
/// rather than an error).
#[tauri::command]
pub fn load_game_timeline(match_id: String) -> Result<MatchTimeline, String> {
    crate::load_game_timeline(&match_id, None)
}

/// Runs the deterministic rules checker over `match_id` and returns the raised
/// findings. Each finding is also persisted as an append-only
/// `analysis.finding.raised` event (read-only over gameplay events; append-only
/// for findings — no event mutation). Findings are hints for a human reviewer,
/// never verdicts.
#[tauri::command]
pub fn analyze_match(match_id: String) -> Result<MatchAnalysis, String> {
    crate::analyze_match(&match_id, None)
}

/// Drains the local sync outbox to the backend `/events` endpoint. HARD-GATED
/// on `PrivacySettings.sync_enabled`: when sync consent is off this makes zero
/// network calls and returns `attempted: false`. When on, it mirrors the store
/// into the outbox and drains pending batches with exponential backoff and one
/// idempotency key per batch (retries never duplicate server rows). Only
/// normalized events are uploaded — never raw log chunks.
#[tauri::command]
pub fn sync_now() -> Result<SyncOutcome, String> {
    crate::sync_now(None, None)
}

/// Reports the local card database status (path, whether it has been imported,
/// total card count and how many carry an Arena id) so the desktop analysis UI
/// can surface an offline "run import-card-db" guidance state. Read-only: opens
/// the sibling `cards.sqlite` when present, never triggers a network download.
#[tauri::command]
pub fn card_db_status() -> Result<CardDbStatusSummary, String> {
    crate::card_db_status(None)
}

/// Writes already-serialized export contents to a user-chosen path (obtained
/// via the native save dialog on the frontend). Offline-only: writes a local
/// file, no network involvement.
#[tauri::command]
pub fn write_export_file(path: String, contents: String) -> Result<String, String> {
    crate::write_export_file(&path, &contents)
}

/// Starts the continuous live watcher over the given Arena log path (or the
/// detected OS default when `log_path` is omitted). Emits a `store-updated`
/// event after every ingest so the UI can refresh. If a watcher is already
/// running its current status is returned unchanged.
#[tauri::command]
pub fn start_watcher(
    app: tauri::AppHandle,
    log_path: Option<String>,
) -> Result<WatcherStatus, String> {
    let mut slot = watcher_slot()
        .lock()
        .map_err(|_| "live watcher state is poisoned".to_owned())?;

    if let Some(existing) = slot.as_ref() {
        if existing.is_running() {
            return Ok(existing.status());
        }
    }
    // Reap any finished/stopped handle before starting a fresh one.
    if let Some(previous) = slot.take() {
        previous.stop();
        previous.join();
    }

    let path = match log_path {
        Some(path) => std::path::PathBuf::from(path),
        None => crate::default_arena_log_path().ok_or_else(|| {
            "no Arena log path was provided and no OS default is known".to_owned()
        })?,
    };

    let emit_handle = app.clone();
    let handle = crate::watch_live_log_follow(
        path,
        None,
        crate::DEFAULT_FOLLOW_POLL_INTERVAL,
        move |_summary| {
            // Enqueue-on-ingest for sync when consent is on (best-effort: a
            // sync-outbox hiccup must never disrupt live watching).
            let _ = crate::enqueue_ingested_events(None, None);
            let _ = emit_handle.emit("store-updated", ());
        },
    )?;
    let status = handle.status();
    *slot = Some(handle);
    Ok(status)
}

/// Stops the live watcher if one is running. Idempotent: returns an idle
/// status whether or not a watcher was active.
#[tauri::command]
pub fn stop_watcher() -> Result<WatcherStatus, String> {
    let mut slot = watcher_slot()
        .lock()
        .map_err(|_| "live watcher state is poisoned".to_owned())?;
    if let Some(handle) = slot.take() {
        handle.stop();
        handle.join();
    }
    Ok(WatcherStatus::idle())
}

/// Returns the current live watcher status, including the detected default
/// Arena log path so the Setup view can show a real path even before any
/// watcher has started.
#[tauri::command]
pub fn watcher_status() -> Result<WatcherStatus, String> {
    let slot = watcher_slot()
        .lock()
        .map_err(|_| "live watcher state is poisoned".to_owned())?;
    Ok(match slot.as_ref() {
        Some(handle) => handle.status(),
        None => WatcherStatus::idle(),
    })
}
