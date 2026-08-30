//! `timing-violation`: positive (a sorcery cast during combat) and near-miss
//! negative (an instant cast during combat — legal because it has instant speed).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-div", "Divination", "Sorcery", "Draw two cards.", 3.0, &[], None),
        card_json("c-opt", "Opt", "Instant", "Scry 1. Draw a card.", 1.0, &[], None),
    ]
}

fn base() -> Vec<core_domain::NormalizedEvent> {
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
        event(
            3,
            EventType::PhaseChange,
            GameAction::PhaseChanged {
                actor: "1".into(),
                card_ref: None,
                phase: "combat".into(),
                step: Some("declareAttackers".into()),
            },
            json!({}),
        ),
    ]
}

fn cast(name: &str) -> core_domain::NormalizedEvent {
    event(
        4,
        EventType::CardCast,
        GameAction::CastSpell {
            actor: "1".into(),
            card_ref: Some(paper_card(name)),
            from_zone: Some(Zone::Hand),
            targets: vec![],
            mana_spent: None,
        },
        json!({}),
    )
}

#[test]
fn flags_sorcery_cast_in_combat() {
    let db = carddb(&cards());
    let mut events = base();
    events.push(cast("Divination"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "timing-violation"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "timing-violation")
        .unwrap();
    assert!(finding.rule_refs.contains(&"CR 307.1".to_owned()));
}

#[test]
fn instant_in_combat_is_legal() {
    let db = carddb(&cards());
    let mut events = base();
    events.push(cast("Opt"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "timing-violation"), 0);
}
