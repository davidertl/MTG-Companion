//! Loopback HTTP service for MancuTG-ArenaC (Overwolf / web UI).
#![forbid(unsafe_code)]

use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use core_domain::ImportSourceKind;
use core_store::EventStore;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

use crate::{
    bootstrap_local_companion, export_backup_bundle, import_ios_logs, inspect_local_store,
    load_arena_settings, reset_arena_settings, reprocess_session, set_consent, wipe_local_data,
    watch_live_log_once_with_store, ArenaSettings, BackupBundle, DesktopBootstrap,
    LiveLogWatchSummary, LocalDataRemovalSummary, LocalStoreSummary, OfflineLogImportSummary,
    ReprocessSessionSummary,
};

const SERVICE_FILE_NAME: &str = "mancutg-arenac-service.json";

/// Default loopback port for UIs (Overwolf / dev) when `--port` is omitted.
pub const DEFAULT_LOOPBACK_PORT: u16 = 17890;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHandshake {
    pub port: u16,
    pub pid: u32,
    pub base_url: String,
    pub data_dir: String,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<ServiceInner>>,
}

struct ServiceInner {
    data_dir: PathBuf,
    log_path: Option<String>,
    store_path: PathBuf,
    settings_path: PathBuf,
    store: Option<EventStore>,
}

impl ServiceInner {
    fn new(data_dir: PathBuf) -> Self {
        let store_path = data_dir.join("mancutg-arenac.sqlite3");
        let settings_path = data_dir.join("mancutg-arenac-settings.json");
        Self {
            data_dir,
            log_path: default_player_log_path(),
            store_path,
            settings_path,
            store: None,
        }
    }

    fn ensure_data_dir(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_dir)
            .map_err(|error| format!("failed to create data directory: {error}"))
    }

    fn store_path_str(&self) -> String {
        self.store_path.to_string_lossy().into_owned()
    }

    fn settings_path_str(&self) -> String {
        self.settings_path.to_string_lossy().into_owned()
    }

    fn open_store_if_needed(&mut self) -> Result<(), String> {
        if self.store.is_none() {
            self.ensure_data_dir()?;
            let store = EventStore::open(&self.store_path)
                .map_err(|error| format!("failed to open store {}: {error}", self.store_path.display()))?;
            self.store = Some(store);
        }
        Ok(())
    }

    fn store_mut(&mut self) -> Result<&mut EventStore, String> {
        self.open_store_if_needed()?;
        self.store
            .as_mut()
            .ok_or_else(|| "internal error: store not opened".to_owned())
    }

    fn set_store_path(&mut self, path: PathBuf) -> Result<(), String> {
        if path != self.store_path {
            self.store_path = path;
            self.store = None;
        }
        self.open_store_if_needed()
    }

    fn set_settings_path(&mut self, path: PathBuf) {
        if path != self.settings_path {
            self.settings_path = path;
        }
    }
}

pub fn default_player_log_path() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(|profile| {
            PathBuf::from(profile)
                .join("AppData")
                .join("LocalLow")
                .join("Wizards Of The Coast")
                .join("MTG Arena")
                .join("Player.log")
                .to_string_lossy()
                .into_owned()
        })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn resolve_data_dir_from_args(args: &[String]) -> Result<PathBuf, String> {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data-dir" => {
                let dir = args
                    .get(i + 1)
                    .ok_or_else(|| "--data-dir requires a path".to_owned())?;
                return Ok(PathBuf::from(dir));
            }
            _ => {}
        }
        i += 1;
    }

    if let Ok(v) = std::env::var("MANCUTG_ARENAC_DATA_DIR") {
        return Ok(PathBuf::from(v));
    }

    dirs::data_local_dir()
        .map(|p| p.join("MancuTG-ArenaC"))
        .ok_or_else(|| "could not resolve a local data directory (set MANCUTG_ARENAC_DATA_DIR)".to_owned())
}

fn parse_port(args: &[String]) -> Result<Option<u16>, String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--port" {
            let p = args
                .get(i + 1)
                .ok_or_else(|| "--port requires a number".to_owned())?;
            return p
                .parse::<u16>()
                .map(Some)
                .map_err(|_| "invalid --port value".to_owned());
        }
        i += 1;
    }
    Ok(None)
}

pub fn parse_serve_args(args: &[String]) -> Result<(PathBuf, Option<u16>), String> {
    Ok((resolve_data_dir_from_args(args)?, parse_port(args)?))
}

fn write_handshake(data_dir: &Path, port: u16) -> Result<PathBuf, String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("failed to create data directory: {error}"))?;
    let path = data_dir.join(SERVICE_FILE_NAME);
    let handshake = ServiceHandshake {
        port,
        pid: process::id(),
        base_url: format!("http://127.0.0.1:{port}"),
        data_dir: data_dir.to_string_lossy().into_owned(),
    };
    let json = serde_json::to_string_pretty(&handshake)
        .map_err(|error| format!("failed to serialize handshake: {error}"))?;
    std::fs::write(&path, json)
        .map_err(|error| format!("failed to write handshake file {}: {error}", path.display()))?;
    Ok(path)
}

fn remove_handshake(path: &Path) {
    let _ = std::fs::remove_file(path);
}

pub async fn run_serve(args: &[String]) -> Result<(), String> {
    let (data_dir, fixed_port) = parse_serve_args(args)?;
    let state = AppState {
        inner: Arc::new(Mutex::new(ServiceInner::new(data_dir.clone()))),
    };

    let (listener, port) = match fixed_port {
        Some(port) => {
            let addr: SocketAddr = format!("127.0.0.1:{port}")
                .parse()
                .map_err(|_| "invalid listen address".to_owned())?;
            let listener = TcpListener::bind(addr).await.map_err(|error| {
                format!("failed to bind {addr}: {error}")
            })?;
            (listener, port)
        }
        None => {
            let preferred: SocketAddr = format!("127.0.0.1:{DEFAULT_LOOPBACK_PORT}")
                .parse()
                .map_err(|_| "invalid default listen address".to_owned())?;
            match TcpListener::bind(preferred).await {
                Ok(listener) => (listener, DEFAULT_LOOPBACK_PORT),
                Err(error) => {
                    eprintln!(
                        "warn: port {DEFAULT_LOOPBACK_PORT} busy ({error}), binding ephemeral port"
                    );
                    let fallback: SocketAddr = "127.0.0.1:0".parse().unwrap();
                    let listener = TcpListener::bind(fallback).await.map_err(|e| {
                        format!("failed to bind ephemeral loopback port: {e}")
                    })?;
                    let port = listener
                        .local_addr()
                        .map_err(|e| format!("failed to read local address: {e}"))?
                        .port();
                    (listener, port)
                }
            }
        }
    };

    let handshake_path = write_handshake(&data_dir, port)?;
    eprintln!(
        "MancuTG-ArenaC serve listening on http://127.0.0.1:{} (handshake: {})",
        port,
        handshake_path.display()
    );

    let app = build_router(state.clone());
    let shutdown = async move {
        let _ = tokio::signal::ctrl_c().await;
        remove_handshake(&handshake_path);
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|error| format!("server error: {error}"))?;

    remove_handshake(&handshake_path);
    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/detect-player-log", get(detect_player_log))
        .route("/v1/status", get(status))
        .route("/v1/configure", post(configure))
        .route("/v1/bootstrap", post(bootstrap_handler))
        .route("/v1/watch/tick", post(watch_tick))
        .route("/v1/store", get(store_summary))
        .route("/v1/reprocess-session", post(reprocess_handler))
        .route("/v1/export-backup", get(export_backup_handler))
        .route("/v1/settings", get(settings_get))
        .route("/v1/settings/consent", post(settings_consent))
        .route("/v1/settings/reset", post(settings_reset))
        .route("/v1/import/ios-file", post(import_ios_file_handler))
        .route("/v1/import/ios-folder", post(import_ios_folder_handler))
        .route("/v1/import/log-text", post(import_log_text_handler))
        .route("/v1/wipe-local-data", post(wipe_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true }))
}

async fn detect_player_log() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "playerLogPath": default_player_log_path()
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    data_dir: String,
    log_path: Option<String>,
    store_path: String,
    settings_path: String,
    default_player_log_path: Option<String>,
}

async fn status(State(state): State<AppState>) -> Result<Json<StatusResponse>, ApiError> {
    let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    Ok(Json(StatusResponse {
        data_dir: inner.data_dir.to_string_lossy().into_owned(),
        log_path: inner.log_path.clone(),
        store_path: inner.store_path_str(),
        settings_path: inner.settings_path_str(),
        default_player_log_path: default_player_log_path(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureBody {
    log_path: Option<String>,
    store_path: Option<String>,
    settings_path: Option<String>,
}

async fn configure(
    State(state): State<AppState>,
    Json(body): Json<ConfigureBody>,
) -> Result<Json<StatusResponse>, ApiError> {
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    inner.ensure_data_dir().map_err(ApiError::from)?;
    if let Some(log) = body.log_path {
        inner.log_path = Some(log);
    }
    if let Some(store) = body.store_path {
        inner
            .set_store_path(PathBuf::from(store))
            .map_err(ApiError::from)?;
    }
    if let Some(settings) = body.settings_path {
        inner.set_settings_path(PathBuf::from(settings));
    }
    Ok(Json(StatusResponse {
        data_dir: inner.data_dir.to_string_lossy().into_owned(),
        log_path: inner.log_path.clone(),
        store_path: inner.store_path_str(),
        settings_path: inner.settings_path_str(),
        default_player_log_path: default_player_log_path(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogPathBody {
    log_path: String,
}

async fn bootstrap_handler(
    State(_state): State<AppState>,
    Json(body): Json<LogPathBody>,
) -> Result<Json<DesktopBootstrap>, ApiError> {
    let result = bootstrap_local_companion("arenac-serve-bootstrap", &body.log_path)
        .map_err(ApiError::from)?;
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchTickBody {
    log_path: Option<String>,
    store_path: Option<String>,
}

async fn watch_tick(
    State(state): State<AppState>,
    Json(body): Json<WatchTickBody>,
) -> Result<Json<LiveLogWatchSummary>, ApiError> {
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    let log_path = body
        .log_path
        .or_else(|| inner.log_path.clone())
        .ok_or_else(|| ApiError::bad_request("logPath not configured; call POST /v1/configure or pass logPath"))?;
    if let Some(ref p) = body.store_path {
        inner
            .set_store_path(PathBuf::from(p))
            .map_err(ApiError::from)?;
    } else {
        inner.open_store_if_needed().map_err(ApiError::from)?;
    }
    let store = inner.store_mut().map_err(ApiError::from)?;
    let summary = watch_live_log_once_with_store(store, Path::new(&log_path)).map_err(ApiError::from)?;
    Ok(Json(summary))
}

async fn store_summary(State(state): State<AppState>) -> Result<Json<LocalStoreSummary>, ApiError> {
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    inner.open_store_if_needed().map_err(ApiError::from)?;
    let path = inner.store_path_str();
    drop(inner);
    let summary = inspect_local_store(Some(&path)).map_err(ApiError::from)?;
    Ok(Json(summary))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReprocessBody {
    session_id: String,
    store_path: Option<String>,
}

async fn reprocess_handler(
    State(state): State<AppState>,
    Json(body): Json<ReprocessBody>,
) -> Result<Json<ReprocessSessionSummary>, ApiError> {
    if let Some(ref p) = body.store_path {
        let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner
            .set_store_path(PathBuf::from(p))
            .map_err(ApiError::from)?;
    }
    let path = {
        let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.store_path_str()
    };
    let summary = reprocess_session(&body.session_id, Some(&path)).map_err(ApiError::from)?;
    Ok(Json(summary))
}

async fn export_backup_handler(
    State(state): State<AppState>,
) -> Result<Json<BackupBundle>, ApiError> {
    let path = {
        let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.open_store_if_needed().map_err(ApiError::from)?;
        inner.store_path_str()
    };
    let bundle = export_backup_bundle(Some(&path)).map_err(ApiError::from)?;
    Ok(Json(bundle))
}

async fn settings_get(State(state): State<AppState>) -> Result<Json<ArenaSettings>, ApiError> {
    let path = {
        let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.settings_path_str()
    };
    let settings = load_arena_settings(Some(&path)).map_err(ApiError::from)?;
    Ok(Json(settings))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsentBody {
    purpose: String,
    enabled: bool,
}

async fn settings_consent(
    State(state): State<AppState>,
    Json(body): Json<ConsentBody>,
) -> Result<Json<ArenaSettings>, ApiError> {
    let path = {
        let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.settings_path_str()
    };
    let settings = set_consent(&body.purpose, body.enabled, Some(&path)).map_err(ApiError::from)?;
    Ok(Json(settings))
}

async fn settings_reset(State(state): State<AppState>) -> Result<Json<ArenaSettings>, ApiError> {
    let path = {
        let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.settings_path_str()
    };
    let settings = reset_arena_settings(Some(&path)).map_err(ApiError::from)?;
    Ok(Json(settings))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportIosFileBody {
    log_path: String,
    store_path: Option<String>,
}

async fn import_ios_file_handler(
    State(state): State<AppState>,
    Json(body): Json<ImportIosFileBody>,
) -> Result<Json<OfflineLogImportSummary>, ApiError> {
    if let Some(ref p) = body.store_path {
        let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner
            .set_store_path(PathBuf::from(p))
            .map_err(ApiError::from)?;
    }
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    let store = inner.store_mut().map_err(ApiError::from)?;
    let summary = import_ios_logs(
        store,
        ImportSourceKind::DragAndDrop,
        vec![PathBuf::from(&body.log_path)],
    )
    .map_err(ApiError::from)?;
    Ok(Json(summary))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportIosFolderBody {
    directory: String,
    store_path: Option<String>,
}

async fn import_ios_folder_handler(
    State(state): State<AppState>,
    Json(body): Json<ImportIosFolderBody>,
) -> Result<Json<OfflineLogImportSummary>, ApiError> {
    if let Some(ref p) = body.store_path {
        let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner
            .set_store_path(PathBuf::from(p))
            .map_err(ApiError::from)?;
    }
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    let store = inner.store_mut().map_err(ApiError::from)?;
    let summary = import_ios_logs(
        store,
        ImportSourceKind::FolderImport,
        vec![PathBuf::from(&body.directory)],
    )
    .map_err(ApiError::from)?;
    Ok(Json(summary))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportLogTextBody {
    file_name: String,
    content: String,
}

/// Accepts raw log text from a browser/Overwolf file picker (no server-local path).
async fn import_log_text_handler(
    State(state): State<AppState>,
    Json(body): Json<ImportLogTextBody>,
) -> Result<Json<OfflineLogImportSummary>, ApiError> {
    let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
    inner.ensure_data_dir().map_err(ApiError::from)?;
    let safe_name: String = body
        .file_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let temp = inner.data_dir.join(format!("upload-{safe_name}"));
    fs::write(&temp, &body.content).map_err(|e| ApiError::from(format!("failed to write temp import: {e}")))?;
    let store = inner.store_mut().map_err(ApiError::from)?;
    let summary = import_ios_logs(
        store,
        ImportSourceKind::DragAndDrop,
        vec![temp.clone()],
    )
    .map_err(ApiError::from)?;
    let _ = fs::remove_file(&temp);
    Ok(Json(summary))
}

async fn wipe_handler(
    State(state): State<AppState>,
) -> Result<Json<LocalDataRemovalSummary>, ApiError> {
    let (store_path, settings_path) = {
        let inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        (inner.store_path_str(), inner.settings_path_str())
    };
    let summary = wipe_local_data(Some(&store_path), Some(&settings_path)).map_err(ApiError::from)?;
    {
        let mut inner = state.inner.lock().map_err(|_| ApiError::internal("lock poisoned"))?;
        inner.store = None;
    }
    Ok(Json(summary))
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn health_status_and_detect_endpoints() {
        let dir = std::env::temp_dir().join(format!(
            "mancutg-arenac-serve-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            inner: Arc::new(Mutex::new(ServiceInner::new(dir.clone()))),
        };
        let app = build_router(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve");
        });
        tokio::time::sleep(Duration::from_millis(80)).await;
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");
        let h = client.get(format!("{base}/health")).send().await.expect("health");
        assert!(h.status().is_success());
        let s = client.get(format!("{base}/v1/status")).send().await.expect("status");
        assert!(s.status().is_success());
        let d = client
            .get(format!("{base}/v1/detect-player-log"))
            .send()
            .await
            .expect("detect");
        assert!(d.status().is_success());
        server.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn watch_tick_accepts_fixture_log() {
        let dir = std::env::temp_dir().join(format!(
            "mancutg-arenac-watch-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let log_path = dir.join("smoke.log");
        std::fs::write(
            &log_path,
            "2026-05-07T04:00:00Z|MATCH_START|match_id=smoke-match|deck=Azorius Control|queue=ranked\n",
        )
        .expect("write log");

        let state = AppState {
            inner: Arc::new(Mutex::new(ServiceInner::new(dir.clone()))),
        };
        let app = build_router(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve");
        });
        tokio::time::sleep(Duration::from_millis(80)).await;
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");
        let r = client
            .post(format!("{base}/v1/watch/tick"))
            .json(&serde_json::json!({
                "logPath": log_path.to_string_lossy()
            }))
            .send()
            .await
            .expect("watch");
        assert!(r.status().is_success(), "{:?}", r.text().await);
        server.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
