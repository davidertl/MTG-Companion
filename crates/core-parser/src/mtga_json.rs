//! MTGA `Player.log` framing helpers.
//!
//! Real Arena logs interleave plain Unity lines, `[UnityCrossThreadLogger]`
//! prefixed lines, request/response markers (`==>` / `<==`), human timestamps,
//! and JSON blobs that are either single-line or pretty-printed across many
//! lines. This module knows how to strip the framing and how to find the
//! balanced JSON region of a record; it also hosts the legacy
//! `eventName`-based JSON mapping that predates the GRE play-level parser.

use core_domain::EventType;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// A single log line with its framing stripped. `body` is always a suffix of
/// the original line (prefixes are only ever removed from the front), so byte
/// offsets into the original line can be recovered via
/// `line.len() - body.len()`.
pub(crate) struct FramedLine<'a> {
    pub body: &'a str,
    pub had_marker: bool,
    pub timestamp_hint: Option<String>,
    pub label_hint: Option<String>,
}

const MARKER_PREFIXES: [&str; 3] = ["[UnityCrossThreadLogger]", "[Client GRE]", "[MTGA]"];

pub(crate) fn line_starts_new_marker(line: &str) -> bool {
    MARKER_PREFIXES
        .iter()
        .any(|prefix| line.trim_start().starts_with(prefix))
}

pub(crate) fn frame_line(line: &str) -> FramedLine<'_> {
    let mut body = line.trim_start();
    let mut had_marker = false;

    for prefix in MARKER_PREFIXES {
        if let Some(rest) = body.strip_prefix(prefix) {
            body = rest.trim_start();
            had_marker = true;
        }
    }

    if let Some(rest) = body.strip_prefix("==>").or_else(|| body.strip_prefix("<==")) {
        body = rest.trim_start();
        had_marker = true;
    }

    let pre_json = match body.find('{') {
        Some(index) => &body[..index],
        None => body,
    };
    let (timestamp_hint, after_timestamp) = split_timestamp_hint(pre_json);
    let label_hint = extract_label_hint(after_timestamp);

    FramedLine {
        body,
        had_marker,
        timestamp_hint,
        label_hint,
    }
}

/// Recognizes leading human-readable timestamps such as
/// `6/28/2026 3:14:15 PM` or `2026-06-28T15:14:15Z` at the start of `text`.
/// Returns the hint (if any) and the remaining text after it.
fn split_timestamp_hint(text: &str) -> (Option<String>, &str) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with(|c: char| c.is_ascii_digit()) {
        return (None, text);
    }

    let mut consumed_end = 0usize;
    let mut token_index = 0usize;
    let mut cursor = 0usize;
    let bytes = trimmed.as_bytes();

    while token_index < 3 {
        while cursor < bytes.len() && bytes[cursor] == b' ' {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len() && bytes[cursor] != b' ' {
            cursor += 1;
        }
        if start == cursor {
            break;
        }
        let raw = &trimmed[start..cursor];
        let token = raw.trim_end_matches(':');
        let accepted = match token_index {
            0 => {
                token.len() >= 6
                    && token
                        .chars()
                        .all(|c| c.is_ascii_digit() || "/-:.TZ+".contains(c))
                    && token.chars().any(|c| "/-:.".contains(c))
            }
            1 => {
                token.contains(':')
                    && token
                        .chars()
                        .all(|c| c.is_ascii_digit() || ":.".contains(c))
            }
            2 => token == "AM" || token == "PM",
            _ => false,
        };
        if !accepted || token.is_empty() {
            break;
        }
        consumed_end = start + token.len();
        token_index += 1;
    }

    if token_index == 0 {
        return (None, text);
    }

    let hint = trimmed[..consumed_end].to_owned();
    let rest = trimmed[consumed_end..].trim_start_matches([':', ' ']);
    (Some(hint), rest)
}

/// Extracts an identifier-like label from pre-JSON text, e.g.
/// `Match to Anon: GreToClientEvent` -> `GreToClientEvent` or
/// `Event_GetCourses(886)` -> `Event_GetCourses`.
fn extract_label_hint(text: &str) -> Option<String> {
    let candidate = text
        .rsplit(|c: char| c.is_whitespace() || c == ':')
        .find(|token| !token.is_empty())?;
    let candidate = candidate.split('(').next()?;
    if candidate.is_empty()
        || !candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
    {
        return None;
    }
    Some(candidate.to_owned())
}

/// Incremental scanner that finds where a JSON value starting at `{` becomes
/// balanced. Feed it consecutive slices; when it returns `Some(end)`, the JSON
/// value ends `end` bytes into the most recently fed slice (exclusive).
#[derive(Default)]
pub(crate) struct JsonScanner {
    depth: i64,
    in_string: bool,
    escaped: bool,
    started: bool,
}

impl JsonScanner {
    pub(crate) fn feed(&mut self, text: &str) -> Option<usize> {
        for (index, byte) in text.bytes().enumerate() {
            if self.in_string {
                if self.escaped {
                    self.escaped = false;
                } else if byte == b'\\' {
                    self.escaped = true;
                } else if byte == b'"' {
                    self.in_string = false;
                }
                continue;
            }
            match byte {
                b'"' => self.in_string = true,
                b'{' | b'[' => {
                    self.depth += 1;
                    self.started = true;
                }
                b'}' | b']' => {
                    self.depth -= 1;
                    if self.started && self.depth <= 0 {
                        return Some(index + 1);
                    }
                }
                _ => {}
            }
        }
        None
    }
}

/// Legacy `eventName`-keyed JSON mapping (five original event types). Returns
/// `None` when the record does not carry the `timestamp` + `eventName` shape.
pub(crate) fn legacy_json_event(
    value: &Value,
) -> Option<(String, EventType, BTreeMap<String, String>)> {
    let object = value.as_object()?;

    let timestamp =
        string_field(object, "timestamp").or_else(|| string_field(object, "timestampUtc"))?;
    let event_name = string_field(object, "eventName").or_else(|| string_field(object, "event"))?;

    let payload_object = object
        .get("payload")
        .and_then(Value::as_object)
        .unwrap_or(object);

    let mut payload = flatten_simple_fields(
        payload_object,
        &["eventName", "event", "timestamp", "timestampUtc"],
    );

    let event_type = match event_name.as_str() {
        "MatchGameRoomStateChanged" => {
            insert_alias(&mut payload, payload_object, "match_id", &["matchId", "match_id"]);
            insert_alias(&mut payload, payload_object, "deck", &["deck", "deckName"]);
            insert_alias(&mut payload, payload_object, "queue", &["queue", "queueId", "gameMode"]);
            insert_alias(&mut payload, payload_object, "result", &["result", "winner", "outcome"]);
            let state = string_field(payload_object, "state")
                .or_else(|| string_field(object, "state"))
                .unwrap_or_default();
            payload.insert("state".to_owned(), state.clone());
            if state.contains("Completed") || state.contains("Ended") {
                EventType::MatchEnd
            } else {
                EventType::MatchStart
            }
        }
        "PlayerInventory.GetPlayerCardsV3" => {
            insert_alias(&mut payload, payload_object, "cards_owned", &["cardsOwned", "cards_owned"]);
            EventType::CollectionSnapshot
        }
        "PlayerInventory.GetPlayerInventory" => {
            insert_alias(&mut payload, payload_object, "gold", &["gold"]);
            insert_alias(&mut payload, payload_object, "gems", &["gems"]);
            insert_alias(&mut payload, payload_object, "wildcards", &["wildcards"]);
            insert_alias(&mut payload, payload_object, "vault", &["vault"]);
            EventType::InventorySnapshot
        }
        "Draft.MakePick" => {
            insert_alias(&mut payload, payload_object, "set_code", &["setCode", "set_code"]);
            insert_alias(&mut payload, payload_object, "pack_number", &["packNumber", "pack_number"]);
            insert_alias(&mut payload, payload_object, "pick_number", &["pickNumber", "pick_number"]);
            insert_alias(&mut payload, payload_object, "choice", &["choice"]);
            EventType::DraftPick
        }
        other => EventType::Unknown(other.to_owned()),
    };

    Some((timestamp, event_type, payload))
}

/// Label used for well-formed JSON records that no extractor recognizes.
pub(crate) fn unknown_label_for(value: &Value, hint: Option<&str>) -> String {
    if let Some(kind) = value
        .get("clientToMatchServiceMessageType")
        .and_then(Value::as_str)
    {
        return kind.to_owned();
    }
    if let Some(hint) = hint {
        return hint.to_owned();
    }
    "MTGA_JSON".to_owned()
}

pub(crate) fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    })
}

pub(crate) fn flatten_simple_fields(
    object: &Map<String, Value>,
    reserved: &[&str],
) -> BTreeMap<String, String> {
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

fn insert_alias(
    payload: &mut BTreeMap<String, String>,
    object: &Map<String, Value>,
    target_key: &str,
    candidate_keys: &[&str],
) {
    for candidate in candidate_keys {
        if let Some(value) = find_scalar_value(object, candidate) {
            payload.insert(target_key.to_owned(), value);
            return;
        }
    }
}

fn find_scalar_value(object: &Map<String, Value>, wanted_key: &str) -> Option<String> {
    if let Some(value) = object.get(wanted_key) {
        return scalar_to_string(value);
    }

    for value in object.values() {
        match value {
            Value::Object(child) => {
                if let Some(found) = find_scalar_value(child, wanted_key) {
                    return Some(found);
                }
            }
            Value::Array(items) => {
                for item in items {
                    if let Value::Object(child) = item {
                        if let Some(found) = find_scalar_value(child, wanted_key) {
                            return Some(found);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn scalar_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}
