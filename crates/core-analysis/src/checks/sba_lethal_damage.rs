//! `sba-lethal-damage` — a creature with marked damage at least equal to its
//! toughness that is still on the battlefield at a later state check
//! (CR 704.5g "A creature with lethal damage marked on it is destroyed as a
//! state-based action").
//!
//! # Fire condition
//!
//! Toughness is not available from the card DB (Scryfall power/toughness is not
//! imported), so this check relies on the reconstructed object carrying a
//! `toughness` counter — which in practice only a paper logger supplies. For
//! each turn it sums `DamageDealt` amounts per target; if a battlefield object
//! with a known `toughness` counter accumulated marked damage `>=` that
//! toughness and is still on the battlefield at end of turn, it raises a
//! `possible-violation`.
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Fires only when toughness is present as an object counter, so Arena-sourced
//!   timelines (which never carry one) never trigger it — this is the "paper
//!   logs mainly" posture from the plan.
//! - Marked damage is summed only within a single turn (damage wears off at
//!   cleanup), and only from `DamageDealt` actions that name the creature.
//! - Indestructibility, regeneration, damage prevention, toughness-boosting
//!   effects, and "damage can't be marked" effects are not modelled.

use std::collections::BTreeMap;

use core_domain::{ActionTarget, GameAction};
use core_gamestate::{ObjectState, TimelineAction};

use crate::{turn_phase_label, CheckContext, Finding, Severity};

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();

    for turn in &ctx.timeline.turns {
        // Sum marked damage per creature (keyed by object ref / card name) for
        // this turn.
        let mut damage: BTreeMap<String, u32> = BTreeMap::new();
        for timeline_action in &turn.actions {
            if let TimelineAction::Parsed(GameAction::DamageDealt { amount, targets, .. }) =
                timeline_action
            {
                for target in targets {
                    for key in target_keys(target) {
                        *damage.entry(key).or_default() += *amount;
                    }
                }
            }
        }
        if damage.is_empty() {
            continue;
        }

        for (player, zones) in &turn.zones {
            for object in &zones.battlefield {
                let Some(toughness) = object.counters.get("toughness").copied() else {
                    continue;
                };
                if toughness <= 0 {
                    continue;
                }
                let marked = object_keys(object)
                    .into_iter()
                    .filter_map(|key| damage.get(&key).copied())
                    .max()
                    .unwrap_or(0);
                if i64::from(marked) < toughness {
                    continue;
                }

                let label = object
                    .card_ref
                    .name
                    .clone()
                    .unwrap_or_else(|| "a creature".to_owned());
                findings.push(ctx.rule_check(
                    "sba-lethal-damage",
                    turn.turn_number,
                    turn_phase_label(turn),
                    Severity::PossibleViolation,
                    0.5,
                    &["CR 704.5g"],
                    format!(
                        "Player {player}'s {label} has {marked} marked damage against toughness \
                         {toughness} but remains on the battlefield; lethal damage should be a \
                         state-based destruction."
                    ),
                ));
            }
        }
    }

    findings
}

/// Matching keys for a damage target: by object ref and by card name.
fn target_keys(target: &ActionTarget) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(object_ref) = &target.object_ref {
        keys.push(format!("obj:{object_ref}"));
    }
    if let Some(card_ref) = &target.card_ref {
        if let Some(name) = &card_ref.name {
            keys.push(format!("name:{}", name.to_lowercase()));
        }
    }
    keys
}

/// Matching keys for a battlefield object, aligned with [`target_keys`].
fn object_keys(object: &ObjectState) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(instance_id) = object.instance_id {
        keys.push(format!("obj:{instance_id}"));
    }
    if let Some(name) = &object.card_ref.name {
        keys.push(format!("name:{}", name.to_lowercase()));
    }
    keys
}
