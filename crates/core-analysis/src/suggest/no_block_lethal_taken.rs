//! `no-block-lethal-taken` — a player died to a combat attack while holding back
//! a creature whose block would have prevented the lethal.
//!
//! # Fire condition
//!
//! Needs a card DB (creature typing + evasion keywords). For a turn in which a
//! player `X` was declared attacked, died (life fell to `0` or below this turn),
//! and declared no blockers, gather the attackers' observed powers
//! ([`observed_power`](super::observed_power)). If `X` controlled at least one
//! creature that could *legally* block one of those attackers (a flyer needs a
//! flyer/reach blocker) and removing that single largest blockable attacker's
//! damage would have left `X` alive, raise an `info` suggestion.
//!
//! # Hidden-information discipline
//!
//! Only public-zone objects and observed combat damage are used — the dying
//! player's battlefield blockers and the attackers' logged damage are all fully
//! visible. No hand information is consulted, so there is nothing hidden to leak.
//!
//! # Blind spots (prefer false negatives)
//!
//! - Only the "declared no blockers and took it" case is considered; a player
//!   who blocked sub-optimally is not analysed (false negative).
//! - Attacker power is the largest observed `DamageDealt`; an attacker that
//!   never dealt observed damage is skipped.
//! - Deathtouch/first-strike/trample interactions and multi-block are not
//!   modelled; only whether a single legal block removes enough damage to
//!   survive is checked.

use std::collections::BTreeMap;

use crate::{resolve_card, turn_phase_label, CheckContext, Finding};

use super::{has_keyword, is_creature, observed_power, STARTING_LIFE};
use core_domain::{CardRef, GameAction};
use core_gamestate::{TimelineAction, TurnSnapshot};

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    if ctx.carddb.is_none() {
        return findings;
    }

    for (index, turn) in ctx.timeline.turns.iter().enumerate() {
        // Attackers declared against each defending player this turn.
        let mut per_defender: BTreeMap<String, Vec<CardRef>> = BTreeMap::new();
        for timeline_action in &turn.actions {
            if let TimelineAction::Parsed(GameAction::DeclareAttackers { attackers, .. }) =
                timeline_action
            {
                for attacker in attackers {
                    let Some(card_ref) = &attacker.card_ref else {
                        continue;
                    };
                    let Some(defender) = attacker
                        .defending_target
                        .as_ref()
                        .and_then(|target| target.player_ref.clone())
                    else {
                        continue;
                    };
                    per_defender.entry(defender).or_default().push(card_ref.clone());
                }
            }
        }

        for (defender, attacker_refs) in per_defender {
            // The defender must have died this turn.
            let final_life = turn
                .life_totals
                .get(&defender)
                .copied()
                .unwrap_or(STARTING_LIFE);
            if final_life > 0 {
                continue;
            }
            // Pre-combat life = the life carried into this turn.
            let pre_life = if index > 0 {
                ctx.timeline.turns[index - 1]
                    .life_totals
                    .get(&defender)
                    .copied()
                    .unwrap_or(STARTING_LIFE)
            } else {
                STARTING_LIFE
            };
            if pre_life <= 0 {
                continue;
            }

            // Only the "declared no blockers and took it" case.
            let declared_blockers = turn.actions.iter().any(|timeline_action| {
                matches!(
                    timeline_action,
                    TimelineAction::Parsed(GameAction::DeclareBlockers { actor, blockers, .. })
                        if actor == &defender && !blockers.is_empty()
                )
            });
            if declared_blockers {
                continue;
            }

            // Total incoming damage from attackers with known power.
            let powers: Vec<i64> = attacker_refs
                .iter()
                .filter_map(|card_ref| observed_power(ctx.timeline, card_ref).map(|power| power as i64))
                .collect();
            if powers.is_empty() {
                continue;
            }
            let total_damage: i64 = powers.iter().sum();

            // Does the defender have a creature able to legally block a flyer?
            let (has_any_blocker, defender_can_block_flyers) =
                defender_block_capability(ctx, turn, &defender);
            if !has_any_blocker {
                continue;
            }

            // Largest single attacker the defender could legally have blocked.
            let mut max_blockable = 0i64;
            for card_ref in &attacker_refs {
                let Some(record) = resolve_card(ctx.carddb, card_ref) else {
                    continue;
                };
                let Some(power) = observed_power(ctx.timeline, card_ref) else {
                    continue;
                };
                let flying = has_keyword(&record, "Flying");
                let legally_blockable = !flying || defender_can_block_flyers;
                if legally_blockable {
                    max_blockable = max_blockable.max(power as i64);
                }
            }
            if max_blockable == 0 {
                continue;
            }

            // Would a single legal block have kept the defender alive?
            if total_damage - max_blockable < pre_life {
                findings.push(ctx.suggestion(
                    "no-block-lethal-taken",
                    turn.turn_number,
                    turn_phase_label(turn),
                    0.4,
                    &["CR 509.1"],
                    format!(
                        "Player {defender} took {total_damage} combat damage and died on turn {} \
                         with no blocks declared; a legal block was available that would have \
                         prevented the lethal.",
                        turn.turn_number
                    ),
                ));
            }
        }
    }

    findings
}

/// Whether the defender controls any creature, and whether any of them can block
/// a flyer (has flying or reach).
fn defender_block_capability(
    ctx: &CheckContext<'_>,
    turn: &TurnSnapshot,
    defender: &str,
) -> (bool, bool) {
    let mut has_any = false;
    let mut can_block_flyers = false;
    if let Some(zones) = turn.zones.get(defender) {
        for object in &zones.battlefield {
            if let Some(record) = resolve_card(ctx.carddb, &object.card_ref) {
                if is_creature(&record) {
                    has_any = true;
                    if has_keyword(&record, "Flying") || has_keyword(&record, "Reach") {
                        can_block_flyers = true;
                    }
                }
            }
        }
    }
    (has_any, can_block_flyers)
}
