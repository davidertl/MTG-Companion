//! `no-block-lethal-taken` suggestion: positive (a player dies to an unblocked
//! attack while controlling a creature whose block would have prevented lethal)
//! and near-miss (the dying player controlled no possible blocker).

mod common;

use common::{card_json, carddb, count_code, event, paper_card};
use core_analysis::analyze;
use core_domain::{ActionTarget, AttackerDeclaration, EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![
        card_json("c-ogre", "Hill Ogre", "Creature — Ogre", "", 4.0, &[], None),
        card_json("c-wall", "Wall of Stone", "Creature — Wall", "Defender", 3.0, &["Defender"], None),
    ]
}

/// Player 1 attacks player 2 (at 3 life) with a 4-power Hill Ogre and player 2
/// takes it to the face. `with_blocker` controls whether player 2 has a Wall of
/// Stone available to block.
fn events(with_blocker: bool) -> Vec<core_domain::NormalizedEvent> {
    let mut events = vec![
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
                card_ref: Some(paper_card("Hill Ogre")),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({}),
        ),
        // Player 2 is at 3 life going into the fatal turn.
        event(
            4,
            EventType::LifeChanged,
            GameAction::LifeChanged {
                actor: "2".into(),
                card_ref: None,
                player_ref: "2".into(),
                delta: -17,
                new_total: Some(3),
            },
            json!({}),
        ),
    ];

    if with_blocker {
        events.push(event(
            5,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "2".into(),
                card_ref: Some(paper_card("Wall of Stone")),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({ "controllerSeatId": 2 }),
        ));
    }

    // Fatal turn: Hill Ogre attacks, deals 4, player 2 takes it (no blocks).
    events.extend([
        event(
            6,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "1".into(),
                card_ref: None,
                turn_number: 2,
            },
            json!({}),
        ),
        event(
            7,
            EventType::AttackersDeclared,
            GameAction::DeclareAttackers {
                actor: "1".into(),
                card_ref: None,
                attackers: vec![AttackerDeclaration {
                    card_ref: Some(paper_card("Hill Ogre")),
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
            8,
            EventType::DamageDealt,
            GameAction::DamageDealt {
                actor: "1".into(),
                card_ref: Some(paper_card("Hill Ogre")),
                amount: 4,
                targets: vec![ActionTarget {
                    player_ref: Some("2".into()),
                    ..ActionTarget::default()
                }],
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
                delta: -4,
                new_total: Some(-1),
            },
            json!({}),
        ),
    ]);

    events
}

#[test]
fn flags_lethal_taken_with_a_block_available() {
    let db = carddb(&cards());
    let timeline = GameTimeline::from_events(&events(true));
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "no-block-lethal-taken"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "no-block-lethal-taken")
        .unwrap();
    assert_eq!(finding.turn_number, 2);
    assert_eq!(finding.kind, core_analysis::FindingKind::Suggestion);
    assert_eq!(finding.severity, core_analysis::Severity::Info);
}

#[test]
fn no_suggestion_without_an_available_blocker() {
    let db = carddb(&cards());
    let timeline = GameTimeline::from_events(&events(false));
    let findings = analyze(&timeline, Some(&db));

    assert_eq!(count_code(&findings, "no-block-lethal-taken"), 0);
}
