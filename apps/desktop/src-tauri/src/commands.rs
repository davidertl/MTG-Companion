use crate::{
    ArenaSettings, BackupBundle, DesktopBootstrap, LiveLogWatchSummary, LocalStoreSummary,
    OfflineLogImportSummary,
};

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
