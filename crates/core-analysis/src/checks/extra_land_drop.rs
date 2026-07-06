//! `extra-land-drop` — more than one land played by a player in a single turn
//! without an observed extra-land enabler (CR 305.2 "A player can normally
//! play only one land during each of their turns"; CR 307.1 covers the
//! sorcery-speed timing land plays share).
//!
//! # Fire condition
//!
//! For each turn, count `PlayLand` actions per actor. If an actor played two or
//! more lands and no extra-land enabler was observed among the cards that actor
//! controlled or referenced that turn, raise a `possible-violation`.
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Enabler detection is best-effort: a curated name list plus, when a card DB
//!   is present, an oracle-text scan for "additional land". Enablers outside the
//!   list and not resolvable in the card DB (or effects that grant extra land
//!   drops from another zone, e.g. an opponent's Rites of Flourishing) are not
//!   recognised, so the check may still fire on a legal board — acceptable only
//!   because the alternative (never firing) has no recall at all.
//! - Relies on `PlayLand` actions actually being logged; a source that logs a
//!   land entering only as a `ZoneTransfer` is not counted (false negative).
//! - Does not model special lands that enter without using the land drop.

use std::collections::BTreeMap;

use core_domain::{CardRef, GameAction};
use core_gamestate::{TimelineAction, TurnSnapshot};

use crate::{resolve_card, turn_phase_label, CheckContext, Finding, Severity};

/// Well-known cards that grant one or more additional land plays. Matched
/// case-insensitively by name so the check works even without a card DB.
const EXTRA_LAND_ENABLERS: &[&str] = &[
    "Exploration",
    "Azusa, Lost but Seeking",
    "Dryad of the Ilysian Grove",
    "Oracle of Mul Daya",
    "Fastbond",
    "Ghirapur Orrery",
    "Rites of Flourishing",
    "Wayward Swordtooth",
    "Mina and Denn, Wildborn",
    "Sakura-Tribe Scout",
    "Burgeoning",
    "Walking Atlas",
    "Budoka Gardener",
];

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();

    for turn in &ctx.timeline.turns {
        let mut land_counts: BTreeMap<&str, u32> = BTreeMap::new();
        for timeline_action in &turn.actions {
            if let TimelineAction::Parsed(GameAction::PlayLand { actor, .. }) = timeline_action {
                *land_counts.entry(actor.as_str()).or_default() += 1;
            }
        }

        for (actor, count) in land_counts {
            if count <= 1 {
                continue;
            }
            if actor_has_enabler(ctx, turn, actor) {
                continue;
            }

            findings.push(ctx.rule_check(
                "extra-land-drop",
                turn.turn_number,
                turn_phase_label(turn),
                Severity::PossibleViolation,
                0.6,
                &["CR 305.2", "CR 307.1"],
                format!(
                    "Player {actor} played {count} lands on turn {}; a player may normally \
                     play only one land per turn and no extra-land enabler was observed.",
                    turn.turn_number
                ),
            ));
        }
    }

    findings
}

/// True when the actor controlled or referenced a recognised extra-land enabler
/// during the turn.
fn actor_has_enabler(ctx: &CheckContext<'_>, turn: &TurnSnapshot, actor: &str) -> bool {
    // Candidate card refs: the actor's end-of-turn battlefield, plus any card
    // referenced by that actor's actions during the turn (covers an enabler
    // that entered and left within the turn).
    let mut candidates: Vec<CardRef> = Vec::new();
    if let Some(zones) = turn.zones.get(actor) {
        for object in &zones.battlefield {
            candidates.push(object.card_ref.clone());
        }
    }
    for timeline_action in &turn.actions {
        if let TimelineAction::Parsed(action) = timeline_action {
            if action.actor() != actor {
                continue;
            }
            if let Some(card_ref) = action_card_ref(action) {
                candidates.push(card_ref.clone());
            }
        }
    }

    candidates.iter().any(|card_ref| is_enabler(ctx, card_ref))
}

fn is_enabler(ctx: &CheckContext<'_>, card_ref: &CardRef) -> bool {
    if let Some(name) = &card_ref.name {
        if EXTRA_LAND_ENABLERS
            .iter()
            .any(|enabler| enabler.eq_ignore_ascii_case(name))
        {
            return true;
        }
    }
    if let Some(record) = resolve_card(ctx.carddb, card_ref) {
        if EXTRA_LAND_ENABLERS
            .iter()
            .any(|enabler| enabler.eq_ignore_ascii_case(&record.name))
        {
            return true;
        }
        if let Some(text) = &record.oracle_text {
            if text.to_lowercase().contains("additional land") {
                return true;
            }
        }
    }
    false
}

/// The primary `card_ref` carried by an action, if any. `PlayLand` refs are
/// ignored on purpose — a land is never its own extra-land enabler.
fn action_card_ref(action: &GameAction) -> Option<&CardRef> {
    match action {
        GameAction::PlayLand { .. } => None,
        GameAction::CastSpell { card_ref, .. }
        | GameAction::ActivateAbility { card_ref, .. }
        | GameAction::TriggerNoted { card_ref, .. }
        | GameAction::ZoneTransfer { card_ref, .. } => card_ref.as_ref(),
        _ => None,
    }
}
