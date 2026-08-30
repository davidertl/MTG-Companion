//! `lethal-available` suggestion: positive (board damage >= defender life, and
//! the defender survived the turn) and near-miss (defender one life above the
//! board's guaranteed damage).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{ActionTarget, AttackerDeclaration, EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![card_json(
        "c-hydra",
        "River Hydra",
        "Creature — Hydra",
        "",
        5.0,
        &[],
        None,
    )]
}

/// Builds a timeline where player 1 has a River Hydra (observed power 5) in
/// play from turn 1, attacked for 5 on turn 2 (leaving player 2 at 15), and by
/// turn 3 player 2 is at `defender_life` with no attack declared.
fn events(defender_life: i64) -> Vec<core_domain::NormalizedEvent> {
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
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "1".into(),
                card_ref: Some(paper_card("River Hydra")),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({}),
        ),
        // Turn 2: the Hydra attacks, establishing its observed power (5).
        event(
            4,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "1".into(),
                card_ref: None,
                turn_number: 2,
            },
            json!({}),
        ),
        event(
            5,
            EventType::AttackersDeclared,
            GameAction::DeclareAttackers {
                actor: "1".into(),
                card_ref: None,
                attackers: vec![AttackerDeclaration {
                    card_ref: Some(paper_card("River Hydra")),
                    defending_target: Some(ActionTarget {
                        player_ref: Some("2".into()),
                        ..ActionTarget::default()
                    }),
                    ..AttackerDeclaration::default()
                }],
            },
            json!({}),
        ),
        event(
            6,
            EventType::DamageDealt,
            GameAction::DamageDealt {
                actor: "1".into(),
                card_ref: Some(paper_card("River Hydra")),
                amount: 5,
                targets: vec![ActionTarget {
                    player_ref: Some("2".into()),
                    ..ActionTarget::default()
                }],
            },
            json!({}),
        ),
        event(
            7,
            EventType::LifeChanged,
            GameAction::LifeChanged {
                actor: "2".into(),
                card_ref: None,
                player_ref: "2".into(),
                delta: -5,
                new_total: Some(15),
            },
            json!({}),
        ),
        // Turn 3: player 1's turn again; player 2 is now low and no attack is
        // declared — lethal on board but not taken.
        event(
            8,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "1".into(),
                card_ref: None,
                turn_number: 3,
            },
            json!({}),
        ),
        event(
            9,
            EventType::LifeChanged,
            GameAction::LifeChanged {
                actor: "2".into(),
                card_ref: None,
                player_ref: "2".into(),
                delta: 0,
                new_total: Some(defender_life),
            },
            json!({}),
        ),
    ]
}

#[test]
fn flags_lethal_left_on_the_board() {
    let db = carddb(&cards());
    let timeline = GameTimeline::from_events(&events(5));
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "lethal-available"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "lethal-available")
        .unwrap();
    assert_eq!(finding.turn_number, 3);
    assert_eq!(finding.kind, core_analysis::FindingKind::Suggestion);
    assert_eq!(finding.severity, core_analysis::Severity::Info);
}

#[test]
fn no_suggestion_when_defender_is_out_of_range() {
    let db = carddb(&cards());
    // Defender at 6, board can only guarantee 5 — not lethal.
    let timeline = GameTimeline::from_events(&events(6));
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "lethal-available"), 0);
}
