//! Engine-level guarantees: both Arena-sourced and paper-sourced timelines are
//! analyzable, and analysis is deterministic (same input -> identical findings,
//! including ordering).

mod common;

use common::{arena_card, card_json, carddb, count_code, event, paper_card};
use core_analysis::{analyze, analyze_with_game_key};
use core_domain::{EventType, GameAction, Zone};
use core_gamestate::GameTimeline;
use serde_json::json;

/// An Arena-sourced timeline (arena ids + raw `instanceId`s) with a plain
/// two-land extra-land-drop.
fn arena_events() -> Vec<core_domain::NormalizedEvent> {
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
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "1".into(),
                card_ref: Some(arena_card(1001)),
                from_zone: Some(Zone::Hand),
            },
            json!({ "instanceId": 11 }),
        ),
        event(
            4,
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "1".into(),
                card_ref: Some(arena_card(1002)),
                from_zone: Some(Zone::Hand),
            },
            json!({ "instanceId": 12 }),
        ),
    ]
}

/// A paper-sourced timeline (names only) with the same violation.
fn paper_events() -> Vec<core_domain::NormalizedEvent> {
    vec![
        event(
            1,
            EventType::GameStart,
            GameAction::GameStarted {
                actor: "Alice".into(),
                card_ref: None,
                players: vec!["Alice".into(), "Bob".into()],
                on_the_play: Some("Alice".into()),
            },
            json!({}),
        ),
        event(
            2,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "Alice".into(),
                card_ref: None,
                turn_number: 1,
            },
            json!({}),
        ),
        event(
            3,
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "Alice".into(),
                card_ref: Some(paper_card("Forest")),
                from_zone: Some(Zone::Hand),
            },
            json!({}),
        ),
        event(
            4,
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "Alice".into(),
                card_ref: Some(paper_card("Mountain")),
                from_zone: Some(Zone::Hand),
            },
            json!({}),
        ),
    ]
}

#[test]
fn arena_and_paper_timelines_are_both_analyzable() {
    let arena = GameTimeline::from_events(&arena_events());
    let paper = GameTimeline::from_events(&paper_events());

    assert_eq!(count_code(&analyze(&arena, None), "extra-land-drop"), 1);
    assert_eq!(count_code(&analyze(&paper, None), "extra-land-drop"), 1);
}

#[test]
fn analysis_is_deterministic() {
    // A richer timeline exercising several checks at once.
    let db = carddb(&[
        card_json("c-div", "Divination", "Sorcery", "Draw two cards.", 3.0, &[], None),
        card_json("c-bear", "Grizzly Bears", "Creature — Bear", "", 2.0, &[], None),
    ]);

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
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "1".into(),
                card_ref: Some(paper_card("Forest")),
                from_zone: Some(Zone::Hand),
            },
            json!({}),
        ),
        event(
            4,
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "1".into(),
                card_ref: Some(paper_card("Island")),
                from_zone: Some(Zone::Hand),
            },
            json!({}),
        ),
        event(
            5,
            EventType::PhaseChange,
            GameAction::PhaseChanged {
                actor: "1".into(),
                card_ref: None,
                phase: "combat".into(),
                step: None,
            },
            json!({}),
        ),
        event(
            6,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "1".into(),
                card_ref: Some(paper_card("Grizzly Bears")),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({}),
        ),
        event(
            7,
            EventType::CardCast,
            GameAction::CastSpell {
                actor: "1".into(),
                card_ref: Some(paper_card("Divination")),
                from_zone: Some(Zone::Hand),
                targets: vec![],
                mana_spent: None,
            },
            json!({}),
        ),
    ];

    let timeline = GameTimeline::from_events(&events);
    let first = analyze_with_game_key(&timeline, Some(&db), "match-xyz");
    let second = analyze_with_game_key(&timeline, Some(&db), "match-xyz");

    assert_eq!(first, second);
    assert!(!first.is_empty());
    // finding ids are unique within a run.
    let mut ids: Vec<&str> = first.iter().map(|finding| finding.finding_id.as_str()).collect();
    ids.sort_unstable();
    let unique = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), unique);
}
