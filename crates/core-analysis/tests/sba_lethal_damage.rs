//! `sba-lethal-damage`: positive (marked damage >= toughness, creature still on
//! the battlefield) and near-miss negative (non-lethal marked damage). The
//! timeline is constructed directly so a `toughness` object counter — which only
//! a paper logger supplies — can be modelled.

mod common;

use std::collections::BTreeMap;

use common::{count_code, paper_card};
use core_analysis::analyze;
use core_domain::{ActionTarget, GameAction};
use core_gamestate::{
    Completeness, GameTimeline, ObjectState, PlayerZones, TimelineAction, TurnSnapshot,
};

fn timeline_with(marked: u32, toughness: i64) -> GameTimeline {
    let mut counters = BTreeMap::new();
    counters.insert("toughness".to_owned(), toughness);

    let creature = ObjectState {
        card_ref: paper_card("Grizzly Bears"),
        controller: Some("p1".to_owned()),
        counters,
        ..ObjectState::default()
    };

    let mut zones = BTreeMap::new();
    zones.insert(
        "p1".to_owned(),
        PlayerZones {
            battlefield: vec![creature],
            ..PlayerZones::default()
        },
    );

    let damage = TimelineAction::Parsed(GameAction::DamageDealt {
        actor: "2".into(),
        card_ref: None,
        amount: marked,
        targets: vec![ActionTarget {
            card_ref: Some(paper_card("Grizzly Bears")),
            ..ActionTarget::default()
        }],
    });

    GameTimeline {
        turns: vec![TurnSnapshot {
            turn_number: 4,
            active_player: Some("2".to_owned()),
            phase: Some("combat".to_owned()),
            zones,
            actions: vec![damage],
            ..TurnSnapshot::default()
        }],
        completeness: Completeness::Complete,
        notes: vec![],
    }
}

#[test]
fn flags_lethal_damage_persisting() {
    let timeline = timeline_with(3, 2);
    let findings = analyze(&timeline, None);

    assert_eq!(count_code(&findings, "sba-lethal-damage"), 1);
    let finding = findings
        .iter()
        .find(|finding| finding.code == "sba-lethal-damage")
        .unwrap();
    assert!(finding.rule_refs.contains(&"CR 704.5g".to_owned()));
}

#[test]
fn non_lethal_damage_is_legal() {
    let timeline = timeline_with(1, 2);
    let findings = analyze(&timeline, None);

    assert_eq!(count_code(&findings, "sba-lethal-damage"), 0);
}
