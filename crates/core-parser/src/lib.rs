//! Log-only MTGA parser: converts Arena `Player.log` fragments into typed
//! `core-domain` events.
//!
//! Two families of input are recognized:
//! - legacy pipe-delimited lines (`timestamp|LABEL|key=value|...`) and
//!   `eventName`-keyed JSON lines (match/collection/inventory/draft), and
//! - detailed-log gameplay records (`GreToClientEvent`,
//!   `matchGameRoomStateChangedEvent`, client mulligan responses), which map
//!   onto the play-level `EventType` variants (see `gre` module).
//!
//! Framing follows the real `Player.log`: `[UnityCrossThreadLogger]`
//! prefixes, `==>`/`<==` request/response markers, human timestamps, and JSON
//! blobs that may be single-line or pretty-printed over many lines.
//!
//! `parse_log_lossy` never panics on malformed input: unrecognized but
//! well-formed records flow to `EventType::Unknown`, and malformed/truncated
//! records degrade to an `Unknown` event plus a `ParseWarning` (which callers
//! persist as ingest diagnostics).

mod gre;
mod mtga_json;

use core_domain::{flat_payload, EventType, NormalizedEvent, ParseReport, RawChunk};
use gre::GreContext;
use mtga_json::{frame_line, line_starts_new_marker, JsonScanner};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Safety cap for multi-line JSON accumulation, so a stray `{` can never
/// swallow an unbounded stretch of the log.
const MAX_RECORD_LINES: usize = 5_000;

/// Cap for raw text echoed into malformed-record payloads.
const MAX_RAW_PAYLOAD_BYTES: usize = 2_048;

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

struct IndexedLine<'a> {
    offset: u64,
    text: &'a str,
}

struct Output<'a> {
    session_id: &'a str,
    sequence: u64,
    raw_chunks: Vec<RawChunk>,
    events: Vec<NormalizedEvent>,
    warnings: Vec<ParseWarning>,
}

impl Output<'_> {
    fn push_chunk(&mut self, offset: u64, raw_text: &str) {
        self.raw_chunks.push(RawChunk {
            session_id: self.session_id.to_owned(),
            offset,
            sha256: sha256(raw_text),
            raw_text: raw_text.to_owned(),
        });
    }

    fn push_event(&mut self, timestamp: String, event_type: EventType, payload: Value) {
        self.sequence += 1;
        self.events.push(NormalizedEvent {
            session_id: self.session_id.to_owned(),
            sequence: self.sequence,
            timestamp,
            event_type,
            payload,
        });
    }

    fn push_warning(&mut self, line: &str, message: String) {
        self.sequence += 1;
        self.warnings.push(ParseWarning {
            sequence: self.sequence,
            line: line.to_owned(),
            message,
        });
    }
}

pub fn parse_log_lossy(session_id: &str, input: &str, starting_offset: u64) -> LossyParseResult {
    let mut lines = Vec::new();
    let mut offset = starting_offset;
    for segment in input.split_inclusive('\n') {
        lines.push(IndexedLine {
            offset,
            text: segment.trim_end_matches(['\r', '\n']),
        });
        offset += segment.len() as u64;
    }
    let next_offset = offset;

    let mut out = Output {
        session_id,
        sequence: 0,
        raw_chunks: Vec::new(),
        events: Vec::new(),
        warnings: Vec::new(),
    };
    let mut ctx = GreContext::default();
    let mut pending_timestamp: Option<String> = None;
    let mut pending_label: Option<String> = None;

    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].text;
        let line_offset = lines[index].offset;
        if line.trim().is_empty() {
            index += 1;
            continue;
        }

        let frame = frame_line(line);
        if let Some(timestamp) = &frame.timestamp_hint {
            pending_timestamp = Some(timestamp.clone());
        }
        if frame.label_hint.is_some() {
            pending_label = frame.label_hint.clone();
        }

        if let Some(json_rel) = frame.body.find('{') {
            let json_abs = line.len() - frame.body.len() + json_rel;
            let mut scanner = JsonScanner::default();
            if let Some(end_rel) = scanner.feed(&line[json_abs..]) {
                // Single-line JSON candidate.
                let json_text = &line[json_abs..json_abs + end_rel];
                if let Ok(value) = serde_json::from_str::<Value>(json_text) {
                    handle_json_record(
                        &mut out,
                        &mut ctx,
                        &value,
                        line,
                        line_offset,
                        pending_timestamp.as_deref(),
                        pending_label.as_deref(),
                    );
                    pending_timestamp = None;
                    pending_label = None;
                    index += 1;
                    continue;
                }
                // Balanced but not valid JSON: fall through to the legacy
                // pipe format (values may legitimately contain braces).
            } else if frame.had_marker || frame.body.trim_start().starts_with('{') {
                // Unbalanced JSON on a marker/blob line: accumulate a
                // multi-line pretty-printed record.
                let mut buffer = String::from(&line[json_abs..]);
                let mut record_end_line: Option<usize> = None;
                let mut json_end: Option<usize> = None;
                let mut cursor = index + 1;
                while cursor < lines.len() && (cursor - index) <= MAX_RECORD_LINES {
                    let continuation = lines[cursor].text;
                    if line_starts_new_marker(continuation) {
                        break;
                    }
                    scanner.feed("\n");
                    buffer.push('\n');
                    if let Some(rel) = scanner.feed(continuation) {
                        json_end = Some(buffer.len() + rel);
                        record_end_line = Some(cursor);
                    }
                    buffer.push_str(continuation);
                    if record_end_line.is_some() {
                        break;
                    }
                    cursor += 1;
                }

                match (record_end_line, json_end) {
                    (Some(last_line), Some(end)) => {
                        let json_text = &buffer[..end];
                        let record_text = join_lines(&lines[index..=last_line]);
                        match serde_json::from_str::<Value>(json_text) {
                            Ok(value) => {
                                handle_json_record(
                                    &mut out,
                                    &mut ctx,
                                    &value,
                                    &record_text,
                                    line_offset,
                                    pending_timestamp.as_deref(),
                                    pending_label.as_deref(),
                                );
                            }
                            Err(error) => {
                                emit_malformed_record(
                                    &mut out,
                                    line,
                                    &record_text,
                                    pending_timestamp.as_deref(),
                                    &format!("malformed JSON record: {error}"),
                                );
                            }
                        }
                        pending_timestamp = None;
                        pending_label = None;
                        index = last_line + 1;
                        continue;
                    }
                    _ => {
                        // Truncated at EOF, interrupted by a new marker line,
                        // or over the line cap: degrade to Unknown + warning.
                        let consumed_end = cursor.min(lines.len());
                        let record_text = join_lines(&lines[index..consumed_end]);
                        emit_malformed_record(
                            &mut out,
                            line,
                            &record_text,
                            pending_timestamp.as_deref(),
                            "truncated JSON record",
                        );
                        pending_timestamp = None;
                        pending_label = None;
                        index = consumed_end.max(index + 1);
                        continue;
                    }
                }
            }
        }

        if parse_pipe_line(&mut out, line, line_offset) {
            pending_timestamp = None;
            pending_label = None;
        } else if frame.had_marker {
            // Framing/context line (e.g. "[UnityCrossThreadLogger]Match to
            // Anon: GreToClientEvent"): keep hints, emit nothing.
        } else {
            out.push_warning(line, format!("invalid log line at sequence {}: {line}", out.sequence + 1));
        }
        index += 1;
    }

    LossyParseResult {
        report: ParseReport {
            raw_chunks: out.raw_chunks,
            events: out.events,
            next_offset,
        },
        warnings: out.warnings,
    }
}

fn join_lines(lines: &[IndexedLine<'_>]) -> String {
    let mut joined = String::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            joined.push('\n');
        }
        joined.push_str(line.text);
    }
    joined
}

fn handle_json_record(
    out: &mut Output<'_>,
    ctx: &mut GreContext,
    value: &Value,
    record_text: &str,
    offset: u64,
    pending_timestamp: Option<&str>,
    pending_label: Option<&str>,
) {
    let fallback_timestamp = pending_timestamp.unwrap_or("");

    if let Some(drafts) = gre::extract_record(value, ctx, fallback_timestamp) {
        out.push_chunk(offset, record_text);
        for draft in drafts {
            out.push_event(draft.timestamp, draft.event_type, draft.payload);
        }
        return;
    }

    if let Some((timestamp, event_type, payload)) = mtga_json::legacy_json_event(value) {
        out.push_chunk(offset, record_text);
        out.push_event(timestamp, event_type, flat_payload(payload));
        return;
    }

    // Well-formed JSON that no extractor recognizes: Unknown funnel.
    let label = mtga_json::unknown_label_for(value, pending_label);
    let timestamp = value
        .get("timestamp")
        .and_then(|ts| match ts {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
        .unwrap_or_else(|| fallback_timestamp.to_owned());
    let payload = value
        .as_object()
        .map(|object| mtga_json::flatten_simple_fields(object, &[]))
        .unwrap_or_default();
    out.push_chunk(offset, record_text);
    out.push_event(timestamp, EventType::Unknown(label), flat_payload(payload));
}

fn emit_malformed_record(
    out: &mut Output<'_>,
    first_line: &str,
    record_text: &str,
    pending_timestamp: Option<&str>,
    reason: &str,
) {
    let mut raw = record_text;
    if raw.len() > MAX_RAW_PAYLOAD_BYTES {
        let mut cut = MAX_RAW_PAYLOAD_BYTES;
        while cut > 0 && !raw.is_char_boundary(cut) {
            cut -= 1;
        }
        raw = &raw[..cut];
    }
    let mut payload = BTreeMap::new();
    payload.insert("reason".to_owned(), reason.to_owned());
    payload.insert("raw".to_owned(), raw.to_owned());

    out.push_event(
        pending_timestamp.unwrap_or("").to_owned(),
        EventType::Unknown("MTGA_MALFORMED_JSON".to_owned()),
        flat_payload(payload),
    );
    out.push_warning(first_line, reason.to_owned());
}

/// Legacy pipe format: `timestamp|LABEL|key=value|...`. Returns `true` when
/// the line was consumed as an event, `false` when it does not match.
fn parse_pipe_line(out: &mut Output<'_>, line: &str, offset: u64) -> bool {
    let mut segments = line.split('|');
    let Some(timestamp) = segments.next().map(str::trim) else {
        return false;
    };
    let Some(label) = segments.next().map(str::trim) else {
        return false;
    };

    let mut payload = BTreeMap::new();
    for segment in segments {
        let Some((key, value)) = segment.split_once('=') else {
            out.push_warning(line, format!("invalid log line at sequence {}: {line}", out.sequence + 1));
            return true;
        };
        payload.insert(key.trim().to_owned(), value.trim().to_owned());
    }

    out.push_chunk(offset, line);
    out.push_event(
        timestamp.to_owned(),
        EventType::from_label(label),
        flat_payload(payload),
    );
    true
}

fn sha256(line: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(line.as_bytes());
    format!("{:x}", hasher.finalize())
}
