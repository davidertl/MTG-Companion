//! `missed-trigger-hint`: positive (a mandatory ETB trigger enters with no noted
//! trigger) and near-miss negatives (an optional "may" ETB, and a mandatory ETB
//! whose trigger was noted).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json(
            "c-vis",
            "Elvish Visionary",
            "Creature — Elf",
            "When Elvish Visionary enters the battlefield, draw a card.",
            2.0,
            &[],
            None,
        ),
        card_json(
            "c-opt",
            "Cautious Scout",
            "Creature — Human",
            "When Cautious Scout enters the battlefield, you may draw a card.",
            2.0,
            &[],
            None,
        ),
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
                turn_number: 2,
            },
            json!({}),
        ),
    ]
}

fn enter(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
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

fn note_trigger(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::TriggerFired,
        GameAction::TriggerNoted {
            actor: "1".into(),
            card_ref: Some(paper_card(name)),
            trigger_text: None,
            targets: vec![],
        },
        json!({}),
    )
}

#[test]
fn hints_when_mandatory_etb_has_no_noted_trigger() {
    let db = carddb(&cards());
    let mut events = base();
    events.push(enter(3, "Elvish Visionary"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "missed-trigger-hint"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "missed-trigger-hint")
        .unwrap();
    assert_eq!(finding.severity, core_analysis::Severity::Info);
}

#[test]
fn no_hint_when_trigger_was_noted() {
    let db = carddb(&cards());
    let mut events = base();
    events.push(enter(3, "Elvish Visionary"));
    events.push(note_trigger(4, "Elvish Visionary"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "missed-trigger-hint"), 0);
}

#[test]
fn no_hint_for_optional_may_trigger() {
    let db = carddb(&cards());
    let mut events = base();
    events.push(enter(3, "Cautious Scout"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "missed-trigger-hint"), 0);
}
