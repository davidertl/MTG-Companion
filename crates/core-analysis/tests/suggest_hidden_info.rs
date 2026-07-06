//! Hidden-information discipline: a hand-dependent suggestion must fire for the
//! player whose hand the engine legitimately observed (the local Arena player)
//! and MUST NEVER fire for a player whose hand is counts-only (an opponent).
//!
//! Both players draw a land and neither plays one. Player 1's draw carries the
//! card's identity (as the local player's draws do on Arena); player 2's draw is
//! a bare count with no `cardRef` (as an opponent's draw is). The `missed-land-
//! drop` suggestion may therefore only ever mention player 1.

mod common;

use common::{card_json, carddb, event, paper_card};
use core_analysis::analyze;
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

fn cards() -> Vec<serde_json::Value> {
    vec![card_json("c-forest", "Forest", "Basic Land — Forest", "", 0.0, &[], None)]
}

#[test]
fn hand_dependent_suggestion_never_fires_for_an_opponent() {
    let db = carddb(&cards());
    let events = vec![
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
        // Player 1's turn: draws a Forest *with identity* (local player), plays
        // no land.
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
                card_ref: Some(paper_card("Forest")),
                from_zone: Zone::Library,
                to_zone: Zone::Hand,
            },
            json!({}),
        ),
        // Player 2's turn: draws a card as a bare count (no identity — the engine
        // cannot see an opponent's hand), plays no land.
        event(
            4,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "2".into(),
                card_ref: None,
                turn_number: 2,
            },
            json!({}),
        ),
        event(
            5,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "2".into(),
                card_ref: None,
                from_zone: Zone::Library,
                to_zone: Zone::Hand,
            },
            json!({}),
        ),
    ];

    let timeline = GameTimeline::from_events(&events);
    let findings = analyze(&timeline, Some(&db));

    let missed: Vec<&core_analysis::Finding> = findings
        .iter()
        .filter(|finding| finding.code == "missed-land-drop")
        .collect();

    // Exactly one — for the local player whose hand is known — and it never
    // references the opponent.
    assert_eq!(missed.len(), 1);
    assert!(missed[0].description.contains("Player 1"));
    assert!(
        !findings
            .iter()
            .any(|finding| finding.description.contains("Player 2")),
        "no suggestion may be raised from the opponent's hidden hand"
    );
}
