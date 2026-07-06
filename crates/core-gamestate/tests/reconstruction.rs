//! Fixture-driven reconstruction tests for `core-gamestate`.
//!
//! Events are constructed directly from `core-domain` types with serialized
//! `GameAction`s under the payload `"action"` key — exactly the shape the Arena
//! parser (`core-parser::gre`) and the PaperC logger emit. Arena fixtures also
//! carry the raw `instanceId`/`controllerSeatId` identifiers next to the action
//! so the instance-id folding path is exercised; paper fixtures carry only card
//! names to prove `CardRef` unifies the two sources.

use core_domain::{CardRef, EventType, GameAction, NormalizedEvent, Zone};
use core_gamestate::{Completeness, GameTimeline, TimelineAction};
use serde_json::{json, Value};

/// Build a normalized gameplay event carrying a serialized action plus any
/// extra raw payload fields (e.g. `instanceId`).
fn event(sequence: u64, event_type: EventType, action: GameAction, extra: Value) -> NormalizedEvent {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "action".to_owned(),
        serde_json::to_value(&action).expect("action serializes"),
    );
    if let Value::Object(map) = extra {
        for (key, value) in map {
            payload.insert(key, value);
        }
    }
    NormalizedEvent {
        session_id: "session-1".to_owned(),
        sequence,
        timestamp: format!("2026-07-06T00:00:{sequence:02}Z"),
        event_type,
        payload: Value::Object(payload),
    }
}

fn arena_card(arena_id: u64) -> CardRef {
    CardRef {
        arena_id: Some(arena_id),
        ..CardRef::default()
    }
}

fn paper_card(name: &str) -> CardRef {
    CardRef {
        name: Some(name.to_owned()),
        ..CardRef::default()
    }
}

/// A short Arena-sourced game: game start, two turns, a land and a creature to
/// battlefield, one creature dying, and a life loss.
fn arena_short_game() -> Vec<NormalizedEvent> {
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
        // Player 1 plays a land from hand -> battlefield.
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
        // Player 1's creature resolves onto the battlefield (stack -> bf).
        event(
            4,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "1".into(),
                card_ref: Some(arena_card(2002)),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({ "instanceId": 12, "controllerSeatId": 1 }),
        ),
        event(
            5,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "2".into(),
                card_ref: None,
                turn_number: 2,
            },
            json!({}),
        ),
        // Player 2 loses 3 life.
        event(
            6,
            EventType::LifeChanged,
            GameAction::LifeChanged {
                actor: "2".into(),
                card_ref: None,
                player_ref: "2".into(),
                delta: -3,
                new_total: Some(17),
            },
            json!({}),
        ),
        // Player 1's creature dies: battlefield -> graveyard.
        event(
            7,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "1".into(),
                card_ref: Some(arena_card(2002)),
                from_zone: Zone::Battlefield,
                to_zone: Zone::Graveyard,
            },
            json!({ "instanceId": 12, "controllerSeatId": 1 }),
        ),
    ]
}

#[test]
fn arena_short_game_reconstructs_zones_and_life_per_turn() {
    let timeline = GameTimeline::from_events(&arena_short_game());
    assert_eq!(timeline.completeness, Completeness::Complete);
    // Turn 0 is the pre-game bucket (holds GameStarted); then turns 1 and 2.
    let turn_numbers: Vec<u32> = timeline.turns.iter().map(|t| t.turn_number).collect();
    assert_eq!(turn_numbers, vec![0, 1, 2]);

    // End of turn 1: player 1 has land + creature on battlefield, nothing dead.
    let turn1 = &timeline.turns[1];
    let p1 = turn1.zones.get("1").expect("player 1 zones");
    assert_eq!(p1.battlefield.len(), 2, "land + creature on battlefield");
    assert!(p1.graveyard.is_empty());
    assert_eq!(turn1.active_player.as_deref(), Some("1"));
    assert_eq!(turn1.life_totals.get("1"), Some(&20));
    assert_eq!(turn1.life_totals.get("2"), Some(&20));

    // End of turn 2: player 2 at 17, player 1's creature moved to graveyard.
    let turn2 = &timeline.turns[2];
    assert_eq!(turn2.active_player.as_deref(), Some("2"));
    assert_eq!(turn2.life_totals.get("2"), Some(&17));
    let p1_t2 = turn2.zones.get("1").expect("player 1 zones");
    assert_eq!(p1_t2.battlefield.len(), 1, "only the land remains");
    assert_eq!(p1_t2.graveyard.len(), 1, "creature in graveyard");
    assert_eq!(p1_t2.graveyard[0].card_ref, arena_card(2002));
    assert_eq!(p1_t2.graveyard[0].instance_id, Some(12));
    assert_eq!(p1_t2.graveyard[0].controller.as_deref(), Some("1"));
}

#[test]
fn zone_transfer_ordering_is_deterministic_regardless_of_input_order() {
    let mut events = arena_short_game();
    let forward = GameTimeline::from_events(&events);
    // Reverse the slice; `from_events` sorts by sequence, so the result must be
    // identical.
    events.reverse();
    let reversed = GameTimeline::from_events(&events);
    assert_eq!(forward, reversed);

    // The creature's battlefield -> graveyard move lands in turn 2 (index 2).
    assert_eq!(forward.turns[2].zones.get("1").unwrap().graveyard.len(), 1);
}

#[test]
fn partial_log_without_game_start_is_partial_and_does_not_panic() {
    // A fragment: a lone life change, no game start, no turn markers.
    let events = vec![event(
        42,
        EventType::LifeChanged,
        GameAction::LifeChanged {
            actor: "2".into(),
            card_ref: None,
            player_ref: "2".into(),
            delta: -2,
            new_total: Some(18),
        },
        json!({}),
    )];
    let timeline = GameTimeline::from_events(&events);
    match &timeline.completeness {
        Completeness::Partial(reason) => assert!(!reason.is_empty()),
        Completeness::Complete => panic!("fragment should be Partial"),
    }
    // Action still landed in the pre-game bucket; life still folded.
    assert_eq!(timeline.turns.len(), 1);
    assert_eq!(timeline.turns[0].turn_number, 0);
    assert_eq!(timeline.turns[0].life_totals.get("2"), Some(&18));
}

#[test]
fn empty_input_is_partial_and_yields_no_turns() {
    let timeline = GameTimeline::from_events(&[]);
    assert!(matches!(timeline.completeness, Completeness::Partial(_)));
    assert!(timeline.turns.is_empty());
}

#[test]
fn unparseable_action_degrades_to_raw_and_marks_partial() {
    // An event that carries an `action` object that is not a valid GameAction.
    let mut payload = serde_json::Map::new();
    payload.insert("action".to_owned(), json!({ "type": "notARealAction" }));
    let events = vec![NormalizedEvent {
        session_id: "session-1".to_owned(),
        sequence: 1,
        timestamp: "2026-07-06T00:00:01Z".to_owned(),
        event_type: EventType::Unknown("WEIRD".to_owned()),
        payload: Value::Object(payload),
    }];
    let timeline = GameTimeline::from_events(&events);
    assert!(matches!(timeline.completeness, Completeness::Partial(_)));
    assert_eq!(timeline.turns.len(), 1);
    match &timeline.turns[0].actions[0] {
        TimelineAction::Raw { note, .. } => assert!(!note.is_empty()),
        TimelineAction::Parsed(_) => panic!("expected a raw fallback action"),
    }
    assert!(!timeline.notes.is_empty());
}

/// The same short game, paper-sourced: identical `GameAction`s but with card
/// *names* instead of arena ids and no raw `instanceId` fields.
fn paper_short_game() -> Vec<NormalizedEvent> {
    vec![
        event(
            1,
            EventType::GameStart,
            GameAction::GameStarted {
                actor: "alice".into(),
                card_ref: None,
                players: vec!["alice".into(), "bob".into()],
                on_the_play: Some("alice".into()),
            },
            json!({}),
        ),
        event(
            2,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "alice".into(),
                card_ref: None,
                turn_number: 1,
            },
            json!({}),
        ),
        event(
            3,
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor: "alice".into(),
                card_ref: Some(paper_card("Forest")),
                from_zone: Some(Zone::Hand),
            },
            json!({}),
        ),
        event(
            4,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "alice".into(),
                card_ref: Some(paper_card("Grizzly Bears")),
                from_zone: Zone::Stack,
                to_zone: Zone::Battlefield,
            },
            json!({}),
        ),
        event(
            5,
            EventType::TurnBegin,
            GameAction::TurnBegan {
                actor: "bob".into(),
                card_ref: None,
                turn_number: 2,
            },
            json!({}),
        ),
        event(
            6,
            EventType::LifeChanged,
            GameAction::LifeChanged {
                actor: "bob".into(),
                card_ref: None,
                player_ref: "bob".into(),
                delta: -3,
                new_total: Some(17),
            },
            json!({}),
        ),
        // Grizzly Bears dies: matched by name (no instance id).
        event(
            7,
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor: "alice".into(),
                card_ref: Some(paper_card("Grizzly Bears")),
                from_zone: Zone::Battlefield,
                to_zone: Zone::Graveyard,
            },
            json!({}),
        ),
    ]
}

#[test]
fn paper_sourced_game_reconstructs_equivalently_via_card_names() {
    let timeline = GameTimeline::from_events(&paper_short_game());
    assert_eq!(timeline.completeness, Completeness::Complete);
    assert_eq!(
        timeline.turns.iter().map(|t| t.turn_number).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );

    let turn1 = &timeline.turns[1];
    assert_eq!(turn1.zones.get("alice").unwrap().battlefield.len(), 2);

    let turn2 = &timeline.turns[2];
    assert_eq!(turn2.life_totals.get("bob"), Some(&17));
    let alice = turn2.zones.get("alice").unwrap();
    assert_eq!(alice.battlefield.len(), 1, "only the Forest remains");
    assert_eq!(alice.battlefield[0].card_ref, paper_card("Forest"));
    assert_eq!(alice.graveyard.len(), 1);
    assert_eq!(alice.graveyard[0].card_ref, paper_card("Grizzly Bears"));
    // Paper objects carry no instance id — identity is the card name.
    assert_eq!(alice.graveyard[0].instance_id, None);
}

#[test]
fn arena_and_paper_short_games_are_structurally_equivalent() {
    let arena = GameTimeline::from_events(&arena_short_game());
    let paper = GameTimeline::from_events(&paper_short_game());

    assert_eq!(arena.completeness, paper.completeness);
    assert_eq!(arena.turns.len(), paper.turns.len());
    for (a, p) in arena.turns.iter().zip(paper.turns.iter()) {
        assert_eq!(a.turn_number, p.turn_number);
        // Battlefield/graveyard counts match across sources even though the
        // identity model differs (instance ids vs names).
        let a_p1 = a.zones.values().next().unwrap();
        let p_p1 = p.zones.values().next().unwrap();
        assert_eq!(a_p1.battlefield.len(), p_p1.battlefield.len());
        assert_eq!(a_p1.graveyard.len(), p_p1.graveyard.len());
    }
}
