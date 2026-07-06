//! `unused-mana-with-play` suggestion: positive (a mana source in play, a
//! castable card known in hand, no spell cast) and near-miss (no mana source, so
//! nothing could have been cast).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-forest", "Forest", "Basic Land — Forest", "", 0.0, &[], None),
        card_json("c-shock", "Shock", "Instant", "Shock deals 2 damage.", 1.0, &[], None),
    ]
}

fn game_start() -> core_domain::NormalizedEvent {
    event(
        1,
        EventType::GameStart,
        GameAction::GameStarted {
            actor: "1".into(),
            card_ref: None,
            players: vec!["1".into(), "2".into()],
            on_the_play: Some("1".into()),
        },
        json!({}),
    )
}

fn turn_begin(sequence: u64) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::TurnBegin,
        GameAction::TurnBegan {
            actor: "1".into(),
            card_ref: None,
            turn_number: 1,
        },
        json!({}),
    )
}

fn source_to_battlefield(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::ZoneTransfer,
        GameAction::ZoneTransfer {
            actor: "1".into(),
            card_ref: Some(paper_card(name)),
            from_zone: Zone::Stack,
            to_zone: Zone::Battlefield,
        },
        json!({}),
    )
}

fn draw_to_hand(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::ZoneTransfer,
        GameAction::ZoneTransfer {
            actor: "1".into(),
            card_ref: Some(paper_card(name)),
            from_zone: Zone::Library,
            to_zone: Zone::Hand,
        },
        json!({}),
    )
}

#[test]
fn flags_castable_card_with_mana_left() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2),
        source_to_battlefield(3, "Forest"),
        draw_to_hand(4, "Shock"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "unused-mana-with-play"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "unused-mana-with-play")
        .unwrap();
    assert_eq!(finding.kind, core_analysis::FindingKind::Suggestion);
    assert_eq!(finding.severity, core_analysis::Severity::Info);
}

#[test]
fn no_suggestion_without_a_mana_source() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2),
        // Shock is castable in hand, but no mana source is in play.
        draw_to_hand(4, "Shock"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "unused-mana-with-play"), 0);
}
