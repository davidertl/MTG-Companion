use core_domain::{EventType, NormalizedEvent, ParseReport, RawChunk};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("invalid log line at sequence {sequence}: {line}")]
    InvalidLine { sequence: u64, line: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseWarning {
    pub sequence: u64,
    pub line: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LossyParseResult {
    pub report: ParseReport,
    pub warnings: Vec<ParseWarning>,
}

pub fn parse_log(session_id: &str, input: &str, starting_offset: u64) -> Result<ParseReport, ParseError> {
    let result = parse_log_lossy(session_id, input, starting_offset);
    if let Some(warning) = result.warnings.first() {
        return Err(ParseError::InvalidLine {
            sequence: warning.sequence,
            line: warning.line.clone(),
        });
    }

    Ok(result.report)
}

pub fn parse_log_lossy(session_id: &str, input: &str, starting_offset: u64) -> LossyParseResult {
    let mut raw_chunks = Vec::new();
    let mut events = Vec::new();
    let mut offset = starting_offset;
    let mut sequence = 0;
    let mut warnings = Vec::new();

    for segment in input.split_inclusive('\n') {
        let line = segment.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            offset += segment.len() as u64;
            continue;
        }

        sequence += 1;
        match parse_line(session_id, sequence, line) {
            Ok(event) => {
                raw_chunks.push(RawChunk {
                    session_id: session_id.to_owned(),
                    offset,
                    sha256: sha256(line),
                    raw_text: line.to_owned(),
                });
                events.push(event);
            }
            Err(error) => warnings.push(ParseWarning {
                sequence,
                line: line.to_owned(),
                message: error.to_string(),
            }),
        }
        offset += segment.len() as u64;
    }

    LossyParseResult {
        report: ParseReport {
            raw_chunks,
            events,
            next_offset: offset,
        },
        warnings,
    }
}

fn parse_line(session_id: &str, sequence: u64, line: &str) -> Result<NormalizedEvent, ParseError> {
    if let Some(json_start) = line.find('{') {
        if let Ok(value) = serde_json::from_str::<Value>(&line[json_start..]) {
            return parse_mtga_json_line(session_id, sequence, line, value);
        }
    }

    let mut segments = line.split('|');
    let timestamp = segments
        .next()
        .ok_or_else(|| ParseError::InvalidLine {
            sequence,
            line: line.to_owned(),
        })?
        .trim()
        .to_owned();
    let label = segments
        .next()
        .ok_or_else(|| ParseError::InvalidLine {
            sequence,
            line: line.to_owned(),
        })?
        .trim();

    let mut payload = BTreeMap::new();
    for segment in segments {
        let (key, value) = segment.split_once('=').ok_or_else(|| ParseError::InvalidLine {
            sequence,
            line: line.to_owned(),
        })?;
        payload.insert(key.trim().to_owned(), value.trim().to_owned());
    }

    Ok(NormalizedEvent {
        session_id: session_id.to_owned(),
        sequence,
        timestamp,
        event_type: EventType::from_label(label),
        payload,
    })
}

fn parse_mtga_json_line(
    session_id: &str,
    sequence: u64,
    line: &str,
    value: Value,
) -> Result<NormalizedEvent, ParseError> {
    let object = value.as_object().ok_or_else(|| ParseError::InvalidLine {
        sequence,
        line: line.to_owned(),
    })?;

    let timestamp = string_field(object, "timestamp")
        .or_else(|| string_field(object, "timestampUtc"))
        .ok_or_else(|| ParseError::InvalidLine {
            sequence,
            line: line.to_owned(),
        })?;

    let event_name = string_field(object, "eventName")
        .or_else(|| string_field(object, "event"))
        .ok_or_else(|| ParseError::InvalidLine {
            sequence,
            line: line.to_owned(),
        })?;

    let payload_object = object
        .get("payload")
        .and_then(Value::as_object)
        .unwrap_or(object);

    let event_type = match event_name.as_str() {
        "MatchGameRoomStateChanged" => {
            let state = string_field(payload_object, "state")
                .or_else(|| string_field(object, "state"))
                .unwrap_or_default();
            if state.contains("Completed") || state.contains("Ended") {
                EventType::MatchEnd
            } else {
                EventType::MatchStart
            }
        }
        "PlayerInventory.GetPlayerCardsV3" => EventType::CollectionSnapshot,
        "PlayerInventory.GetPlayerInventory" => EventType::InventorySnapshot,
        "Draft.MakePick" => EventType::DraftPick,
        other => EventType::Unknown(other.to_owned()),
    };

    Ok(NormalizedEvent {
        session_id: session_id.to_owned(),
        sequence,
        timestamp,
        event_type,
        payload: flatten_simple_fields(payload_object, &["eventName", "event", "timestamp", "timestampUtc"]),
    })
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    })
}

fn flatten_simple_fields(object: &Map<String, Value>, reserved: &[&str]) -> BTreeMap<String, String> {
    let mut payload = BTreeMap::new();
    for (key, value) in object {
        if reserved.contains(&key.as_str()) {
            continue;
        }

        match value {
            Value::String(text) => {
                payload.insert(key.clone(), text.clone());
            }
            Value::Number(number) => {
                payload.insert(key.clone(), number.to_string());
            }
            Value::Bool(flag) => {
                payload.insert(key.clone(), flag.to_string());
            }
            _ => {}
        }
    }

    payload
}

fn sha256(line: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(line.as_bytes());
    format!("{:x}", hasher.finalize())
}
