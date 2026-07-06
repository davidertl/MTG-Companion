//! Heuristic "better move" suggestions for MancuTG-Companion (`core-analysis`,
//! part 2).
//!
//! Suggestions are the same [`Finding`](crate::Finding) type as rule-checks but
//! carry [`FindingKind::Suggestion`](crate::FindingKind::Suggestion),
//! [`Severity::Info`](crate::Severity::Info), and the mode-default audience
//! [`Audience::Players`](crate::Audience::Players). They are *hints for a human*,
//! never instructions, and — like the rule checker — they are produced by a pure
//! function over the reconstructed [`GameTimeline`] plus optional offline card
//! knowledge. They are folded into the same [`analyze`](crate::analyze) output
//! as rule-checks so a caller receives both together.
//!
//! # Combat math is deliberately shallow
//!
//! Only simple power/toughness arithmetic is done, with flying / reach /
//! deathtouch read from the card DB `keywords` — no deeper ability evaluation.
//!
//! # Where creature power comes from
//!
//! The frozen `core-carddb` contract (`CardRecord`) does **not** expose a
//! power/toughness column, and this unit may not edit that crate. Combat
//! suggestions therefore infer a creature's power from **observed
//! `DamageDealt` events** in the timeline (the largest amount a creature has
//! been logged dealing), never by fabricating a stat the engine has not seen.
//! A creature that has never dealt observed damage has unknown power and is
//! simply skipped — a false negative, which the plan explicitly prefers over a
//! false positive. The card DB is still consulted for keywords (flying / reach)
//! that decide block legality.
//!
//! # Hidden-information discipline (critical)
//!
//! Suggestions must never reason about cards the engine has no right to know.
//! Public zones (battlefield, graveyard, exile) are fully observed and are fair
//! game. Hidden zones (hand, library) are *counts only* in the reconstruction —
//! the timeline never carries an opponent's hand contents. The hand-dependent
//! suggestions ([`missed_land_drop`], [`unused_mana_with_play`]) therefore build
//! a **known-hand set** purely from actions that revealed a card's identity
//! entering a hand ([`known_hands_per_turn`]). For Arena the local player's
//! draws carry identity; opponents' draws arrive as counts with no `cardRef`, so
//! an opponent's known-hand set stays empty and hand-dependent suggestions can
//! *never* fire for them. This is the enforcement point, and each module repeats
//! it in its own docs.

use std::collections::{BTreeMap, BTreeSet};

use core_carddb::CardRecord;
use core_domain::{CardRef, GameAction, Zone};
use core_gamestate::{GameTimeline, PlayerZones, TimelineAction, TurnSnapshot};

use crate::{resolve_card, CheckContext};

pub(crate) mod lethal_available;
pub(crate) mod missed_land_drop;
pub(crate) mod no_block_lethal_taken;
pub(crate) mod unused_mana_with_play;

/// Life a player starts a game with, used as a fallback when no earlier life
/// total was observed for a player.
pub(crate) const STARTING_LIFE: i64 = 20;

/// True when the card's type line marks it as a land.
pub(crate) fn is_land(record: &CardRecord) -> bool {
    type_line_contains(record, "land")
}

/// True when the card's type line marks it as a creature.
pub(crate) fn is_creature(record: &CardRecord) -> bool {
    type_line_contains(record, "creature")
}

fn type_line_contains(record: &CardRecord, needle: &str) -> bool {
    record
        .type_line
        .as_deref()
        .map(|type_line| type_line.to_lowercase().contains(needle))
        .unwrap_or(false)
}

/// True when a card can plausibly produce mana: any land, or a permanent whose
/// rules text adds mana. Deliberately loose so we never *under*-count sources
/// when deciding a spell could have been cast; but note the callers that want a
/// conservative (few-fires) posture only credit resolved sources.
pub(crate) fn is_mana_source(record: &CardRecord) -> bool {
    if is_land(record) {
        return true;
    }
    record
        .oracle_text
        .as_deref()
        .map(|text| text.to_lowercase().contains("add "))
        .unwrap_or(false)
}

/// True when the card carries `keyword` (case-insensitive) either as a listed
/// keyword or verbatim in its rules text.
pub(crate) fn has_keyword(record: &CardRecord, keyword: &str) -> bool {
    if record
        .keywords
        .iter()
        .any(|listed| listed.eq_ignore_ascii_case(keyword))
    {
        return true;
    }
    record
        .oracle_text
        .as_deref()
        .map(|text| text.to_lowercase().contains(&keyword.to_lowercase()))
        .unwrap_or(false)
}

/// True when a card reference carries at least one concrete identifier.
pub(crate) fn has_identity(card_ref: &CardRef) -> bool {
    *card_ref != CardRef::default()
}

/// Two card references identify the same card when any concrete identifier
/// agrees (arena id, oracle id, or name). Mirrors the reconstruction's own
/// matcher (which is private to `core-gamestate`).
pub(crate) fn refs_match(a: &CardRef, b: &CardRef) -> bool {
    if let (Some(x), Some(y)) = (a.arena_id, b.arena_id) {
        return x == y;
    }
    if let (Some(x), Some(y)) = (&a.scryfall_oracle_id, &b.scryfall_oracle_id) {
        return x == y;
    }
    match (&a.name, &b.name) {
        (Some(x), Some(y)) => x.eq_ignore_ascii_case(y),
        _ => false,
    }
}

/// The known-identity cards in each player's hand at the *end* of each turn,
/// parallel to `timeline.turns`.
///
/// Only cards the engine actually observed — entering a hand with identity — are
/// tracked. Opponent draws arrive as counts with no `cardRef`, so an opponent's
/// entry stays empty; this is what stops hand-dependent suggestions from firing
/// for a player whose hand the engine cannot legitimately see.
pub(crate) fn known_hands_per_turn(
    timeline: &GameTimeline,
) -> Vec<BTreeMap<String, Vec<CardRef>>> {
    let mut hands: BTreeMap<String, Vec<CardRef>> = BTreeMap::new();
    let mut per_turn = Vec::with_capacity(timeline.turns.len());

    for turn in &timeline.turns {
        for timeline_action in &turn.actions {
            if let TimelineAction::Parsed(action) = timeline_action {
                apply_hand_mutation(&mut hands, action);
            }
        }
        per_turn.push(hands.clone());
    }
    per_turn
}

fn apply_hand_mutation(hands: &mut BTreeMap<String, Vec<CardRef>>, action: &GameAction) {
    match action {
        // A card revealed entering a hand: only add it when it carries identity.
        GameAction::ZoneTransfer {
            actor,
            card_ref: Some(card_ref),
            to_zone: Zone::Hand,
            ..
        } if has_identity(card_ref) => {
            hands.entry(actor.clone()).or_default().push(card_ref.clone());
        }
        // A card leaving a hand — drop one matching known card if we tracked it.
        GameAction::ZoneTransfer {
            actor,
            card_ref,
            from_zone: Zone::Hand,
            ..
        } => remove_known(hands, actor, card_ref.as_ref()),
        GameAction::PlayLand {
            actor,
            card_ref,
            from_zone,
        } if from_zone.map(|zone| zone == Zone::Hand).unwrap_or(true) => {
            remove_known(hands, actor, card_ref.as_ref());
        }
        GameAction::CastSpell {
            actor,
            card_ref,
            from_zone,
            ..
        } if from_zone.map(|zone| zone == Zone::Hand).unwrap_or(true) => {
            remove_known(hands, actor, card_ref.as_ref());
        }
        _ => {}
    }
}

fn remove_known(
    hands: &mut BTreeMap<String, Vec<CardRef>>,
    player: &str,
    card_ref: Option<&CardRef>,
) {
    let Some(card_ref) = card_ref else {
        return;
    };
    let Some(list) = hands.get_mut(player) else {
        return;
    };
    if let Some(index) = list.iter().position(|known| refs_match(known, card_ref)) {
        list.remove(index);
    }
}

/// The largest observed `DamageDealt` amount attributed to `card_ref` anywhere
/// in the timeline — a lower bound on that creature's power derived purely from
/// what the engine has seen. `None` when the creature has never dealt observed
/// damage (its power is unknown, so combat suggestions skip it).
pub(crate) fn observed_power(timeline: &GameTimeline, card_ref: &CardRef) -> Option<u32> {
    let mut best: Option<u32> = None;
    for turn in &timeline.turns {
        for timeline_action in &turn.actions {
            if let TimelineAction::Parsed(GameAction::DamageDealt {
                card_ref: Some(source),
                amount,
                ..
            }) = timeline_action
            {
                if refs_match(source, card_ref) {
                    best = Some(best.map_or(*amount, |current| current.max(*amount)));
                }
            }
        }
    }
    best
}

/// Lowercased names of creatures observed entering the battlefield during this
/// turn (used to skip summoning-sick creatures unless they have haste).
pub(crate) fn entered_battlefield_names(turn: &TurnSnapshot) -> BTreeSet<String> {
    let mut entered = BTreeSet::new();
    for timeline_action in &turn.actions {
        if let TimelineAction::Parsed(GameAction::ZoneTransfer {
            card_ref: Some(card_ref),
            to_zone: Zone::Battlefield,
            ..
        }) = timeline_action
        {
            if let Some(name) = &card_ref.name {
                entered.insert(name.to_lowercase());
            }
        }
    }
    entered
}

/// Count the resolved mana sources on a player's end-of-turn battlefield.
/// Unresolvable permanents are skipped (under-counting sources), keeping the
/// hand-mana suggestion conservative.
pub(crate) fn count_mana_sources(ctx: &CheckContext<'_>, zones: Option<&PlayerZones>) -> usize {
    let Some(zones) = zones else {
        return 0;
    };
    zones
        .battlefield
        .iter()
        .filter(|object| {
            resolve_card(ctx.carddb, &object.card_ref)
                .map(|record| is_mana_source(&record))
                .unwrap_or(false)
        })
        .count()
}

/// Count a player's own actions of a kind within a turn, via `matcher`.
pub(crate) fn count_player_actions(
    turn: &TurnSnapshot,
    player: &str,
    matcher: impl Fn(&GameAction) -> bool,
) -> usize {
    turn.actions
        .iter()
        .filter(|timeline_action| match timeline_action {
            TimelineAction::Parsed(action) => action.actor() == player && matcher(action),
            TimelineAction::Raw { .. } => false,
        })
        .count()
}
