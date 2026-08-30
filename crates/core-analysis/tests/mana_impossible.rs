//! `mana-impossible`: positive (a 7-mana spell cast over two lands) and near-miss
//! negative (a 6-mana spell over two lands — exactly affordable at the generous
//! per-source credit).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-mtn", "Mountain", "Basic Land — Mountain", "", 0.0, &[], None),
        card_json("c-big", "Colossus", "Creature — Golem", "", 7.0, &[], None),
        card_json("c-mid", "Ogre", "Creature — Ogre", "", 6.0, &[], None),
    ]
}

fn board_with_two_mountains() -> Vec<core_domain::NormalizedEvent> {
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
                turn_number: 5,
            },
            json!({}),
        ),
        // Mountains arrive via zone transfer (not a land drop) so this fixture
        // isolates the mana check from extra-land-drop.
        zone_to_battlefield(3, "Mountain"),
        zone_to_battlefield(4, "Mountain"),
    ]
}

fn zone_to_battlefield(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
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

fn cast(name: &str) -> core_domain::NormalizedEvent {
    event(
        5,
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
fn flags_cast_exceeding_available_mana() {
    let db = carddb(&cards());
    let mut events = board_with_two_mountains();
    events.push(cast("Colossus"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "mana-impossible"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "mana-impossible")
        .unwrap();
    assert!(finding.rule_refs.contains(&"CR 601.2".to_owned()));
}

#[test]
fn affordable_cast_is_not_flagged() {
    let db = carddb(&cards());
    let mut events = board_with_two_mountains();
    events.push(cast("Ogre"));

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "mana-impossible"), 0);
}
