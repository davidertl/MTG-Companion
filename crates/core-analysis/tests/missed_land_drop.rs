//! `missed-land-drop` suggestion: positive (a land known in hand, no land
//! played) and near-miss (the land was played, so nothing is missed).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-forest", "Forest", "Basic Land — Forest", "", 0.0, &[], None),
        card_json("c-bear", "Grizzly Bears", "Creature — Bear", "", 2.0, &[], None),
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

fn turn_begin(sequence: u64, turn_number: u32) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::TurnBegin,
        GameAction::TurnBegan {
            actor: "1".into(),
            card_ref: None,
            turn_number,
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

fn play_land(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::LandPlayed,
        GameAction::PlayLand {
            actor: "1".into(),
            card_ref: Some(paper_card(name)),
            from_zone: Some(Zone::Hand),
        },
        json!({}),
    )
}

#[test]
fn flags_a_land_left_in_hand() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        draw_to_hand(3, "Forest"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "missed-land-drop"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "missed-land-drop")
        .unwrap();
    assert_eq!(finding.kind, core_analysis::FindingKind::Suggestion);
    assert_eq!(finding.severity, core_analysis::Severity::Info);
    assert_eq!(finding.audience, core_analysis::Audience::Players);
}

#[test]
fn no_suggestion_when_the_land_was_played() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        draw_to_hand(3, "Forest"),
        play_land(4, "Forest"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "missed-land-drop"), 0);
}
