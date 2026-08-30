//! `extra-land-drop`: positive (two lands, no enabler) and near-miss negative
//! (two lands with a known extra-land enabler on the battlefield).

mod common;

use common::{count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn game_start_turn_one() -> Vec<core_domain::NormalizedEvent> {
    vec![
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
        ),
        event(
            2,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "1".into(),
                card_ref: None,
                turn_number: 1,
            },
            json!({}),
        ),
    ]
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
fn flags_two_lands_without_enabler() {
    let mut events = game_start_turn_one();
    events.push(play_land(3, "Forest"));
    events.push(play_land(4, "Mountain"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, None);

    assert_eq!(count_code(&findings, "extra-land-drop"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "extra-land-drop")
        .unwrap();
    assert_eq!(finding.turn_number, 1);
    assert!(finding.rule_refs.contains(&"CR 305.2".to_owned()));
}

#[test]
fn suppressed_by_extra_land_enabler_on_battlefield() {
    let mut events = game_start_turn_one();
    // The actor controls Exploration, which grants an additional land play.
    events.push(event(
        3,
        EventType::ZoneTransfer,
        GameAction::ZoneTransfer {
            actor: "1".into(),
            card_ref: Some(paper_card("Exploration")),
            from_zone: Zone::Stack,
            to_zone: Zone::Battlefield,
        },
        json!({}),
    ));
    events.push(play_land(4, "Forest"));
    events.push(play_land(5, "Mountain"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, None);

    assert_eq!(count_code(&findings, "extra-land-drop"), 0);
}
