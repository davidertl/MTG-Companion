use core_domain::{CollectionSnapshot, DraftPick, EventType, InventorySnapshot, MatchRecord};
use core_parser::parse_log_lossy;
use core_store::EventStore;
use std::{fs, path::Path};

#[derive(Debug)]
pub struct DesktopBootstrap {
    pub match_history: Vec<MatchRecord>,
    pub collection_snapshot: Option<CollectionSnapshot>,
    pub inventory_snapshot: Option<InventorySnapshot>,
    pub draft_picks: Vec<DraftPick>,
    pub unknown_events: Vec<String>,
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
