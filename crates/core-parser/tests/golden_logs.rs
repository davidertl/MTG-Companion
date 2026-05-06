use core_domain::{EventType, payload_value};
use core_parser::parse_log;

#[test]
fn parses_known_and_unknown_events_from_a_golden_log() {
    let log = "\
2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Azorius Control|queue=ranked
2026-05-06T21:03:00Z|COLLECTION_SNAPSHOT|cards_owned=412
2026-05-06T21:05:00Z|DRAFT_PICK|set_code=OTJ|pack_number=1|pick_number=3|choice=Vaultborn Tyrant
2026-05-06T21:06:00Z|PATCH_SPECIFIC_EVENT|foo=bar
";

    let report = parse_log("session-1", log, 0).expect("golden log should parse");

    assert_eq!(report.raw_chunks.len(), 4);
    assert_eq!(report.events.len(), 4);
    assert_eq!(report.next_offset, log.len() as u64);

    assert_eq!(report.events[0].event_type, EventType::MatchStart);
    assert_eq!(
        payload_value(&report.events[0].payload, "deck").as_deref(),
        Some("Azorius Control")
    );

    assert_eq!(report.events[1].event_type, EventType::CollectionSnapshot);
    assert_eq!(
        payload_value(&report.events[2].payload, "choice").as_deref(),
        Some("Vaultborn Tyrant")
    );

    assert_eq!(
        report.events[3].event_type,
        EventType::Unknown("PATCH_SPECIFIC_EVENT".to_owned())
    );
}

#[test]
fn preserves_offsets_for_crlf_and_no_trailing_newline_inputs() {
    let log = "2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Azorius\r\n2026-05-06T21:05:00Z|MATCH_END|match_id=match-1|result=win";

    let report = parse_log("session-1", log, 100).expect("log should parse");

    assert_eq!(report.raw_chunks[0].offset, 100);
    assert_eq!(report.raw_chunks[1].offset, 100 + "2026-05-06T21:00:00Z|MATCH_START|match_id=match-1|deck=Azorius\r\n".len() as u64);
    assert_eq!(report.next_offset, 100 + log.len() as u64);
}

#[test]
fn skips_blank_lines_and_reports_invalid_segments() {
    let malformed = "\n2026-05-06T21:00:00Z|MATCH_START|match_id\n";

    let error = parse_log("session-1", malformed, 0).expect_err("malformed log should fail");

    let message = error.to_string();
    assert!(message.contains("invalid log line"));
    assert!(message.contains("sequence 1"));
}
