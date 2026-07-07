//! `illegal-attack`: positive (a creature that entered this turn without haste
//! attacks) and near-miss negatives (a hasty creature entering-and-attacking,
//! and a creature that entered a previous turn attacking legally).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{ActionTarget, AttackerDeclaration, EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-bear", "Grizzly Bears", "Creature — Bear", "", 2.0, &[], None),
        card_json("c-gob", "Raging Goblin", "Creature — Goblin", "Haste", 1.0, &["Haste"], None),
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

fn enter_battlefield(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
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

fn declare_attack(sequence: u64, name: &str) -> core_domain::NormalizedEvent {
    event(
        sequence,
        EventType::AttackersDeclared,
        GameAction::DeclareAttackers {
            actor: "1".into(),
            card_ref: None,
            attackers: vec![AttackerDeclaration {
                card_ref: Some(paper_card(name)),
                defending_target: Some(ActionTarget {
                    player_ref: Some("2".into()),
                    ..ActionTarget::default()
                }),
                ..AttackerDeclaration::default()
            }],
        },
        json!({}),
    )
}

#[test]
fn flags_summoning_sick_attacker() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        enter_battlefield(3, "Grizzly Bears"),
        declare_attack(4, "Grizzly Bears"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "illegal-attack"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "illegal-attack")
        .unwrap();
    assert!(finding.rule_refs.contains(&"CR 302.6".to_owned()));
}

#[test]
fn hasty_creature_may_attack_the_turn_it_enters() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        enter_battlefield(3, "Raging Goblin"),
        declare_attack(4, "Raging Goblin"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "illegal-attack"), 0);
}

#[test]
fn creature_that_entered_a_previous_turn_may_attack() {
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        enter_battlefield(3, "Grizzly Bears"),
        turn_begin(4, 3),
        declare_attack(5, "Grizzly Bears"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "illegal-attack"), 0);
}

#[test]
fn older_copy_may_attack_while_a_same_named_copy_enters_this_turn() {
    // An older Grizzly Bears (turn 1) attacks on turn 3 while a *second* copy
    // enters this turn. Attacking with the older copy is legal; name-only
    // matching must not flag it (regression for the same-name false positive).
    let db = carddb(&cards());
    let events = vec![
        game_start(),
        turn_begin(2, 1),
        enter_battlefield(3, "Grizzly Bears"),
        turn_begin(4, 3),
        enter_battlefield(5, "Grizzly Bears"),
        declare_attack(6, "Grizzly Bears"),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "illegal-attack"), 0);
}
