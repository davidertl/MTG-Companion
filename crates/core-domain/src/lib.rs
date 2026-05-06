use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawChunk {
    pub session_id: String,
    pub offset: u64,
    pub sha256: String,
    pub raw_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum EventType {
    MatchStart,
    MatchEnd,
    CollectionSnapshot,
    InventorySnapshot,
    DraftPick,
    Unknown(String),
}

impl EventType {
    pub fn from_label(label: &str) -> Self {
        match label {
            "MATCH_START" => Self::MatchStart,
            "MATCH_END" => Self::MatchEnd,
            "COLLECTION_SNAPSHOT" => Self::CollectionSnapshot,
            "INVENTORY_SNAPSHOT" => Self::InventorySnapshot,
            "DRAFT_PICK" => Self::DraftPick,
            other => Self::Unknown(other.to_owned()),
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::MatchStart => "MATCH_START",
            Self::MatchEnd => "MATCH_END",
            Self::CollectionSnapshot => "COLLECTION_SNAPSHOT",
            Self::InventorySnapshot => "INVENTORY_SNAPSHOT",
            Self::DraftPick => "DRAFT_PICK",
            Self::Unknown(label) => label.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedEvent {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub event_type: EventType,
    pub payload: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseReport {
    pub raw_chunks: Vec<RawChunk>,
    pub events: Vec<NormalizedEvent>,
    pub next_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchRecord {
    pub match_id: String,
    pub deck: String,
    pub result: Option<String>,
    pub queue: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionSnapshot {
    pub cards_owned: u32,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventorySnapshot {
    pub gold: u32,
    pub gems: u32,
    pub wildcards: u32,
    pub vault: u32,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftPick {
    pub set_code: String,
    pub pack_number: u8,
    pub pick_number: u8,
    pub choice: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncObject {
    pub object_type: String,
    pub object_id: String,
    pub payload: serde_json::Value,
    pub dirty: bool,
    pub last_error: Option<String>,
}

pub fn payload_value(payload: &BTreeMap<String, String>, key: &str) -> Option<String> {
    payload.get(key).cloned()
}
