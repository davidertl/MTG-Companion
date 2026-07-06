//! `lethal-available` — the active player could have swung for lethal but the
//! defender survived the turn.
//!
//! # Fire condition
//!
//! Needs a card DB (creature typing + evasion keywords). For a turn with a known
//! active player and exactly one living opponent, gather the active player's
//! battlefield creatures that (a) are not summoning-sick this turn (or have
//! haste) and (b) have a *known* power from observed combat damage
//! ([`observed_power`](super::observed_power)). Model the defender blocking
//! optimally to minimise damage — evasive flyers (defender has no flyer/reach)
//! always connect; the rest are blocked highest-power-first up to the defender's
//! creature count. If the resulting guaranteed damage is at least the defender's
//! life *and the defender was still alive at the end of the turn* (lethal not
//! taken), raise an `info` suggestion.
//!
//! # Hidden-information discipline
//!
//! Reasons only about public-zone objects (both players' battlefields are fully
//! observed) and about power the engine has actually seen a creature deal. It
//! never consults a hand, so there is no hidden-hand exposure here.
//!
//! # Blind spots (prefer false negatives)
//!
//! - A creature that has never dealt observed damage has unknown power and is
//!   skipped, so a board that is genuinely lethal can go unflagged.
//! - Deathtouch, trample, first strike, menace and combat tricks are not
//!   modelled; blocking is treated with maximum flexibility (any blocker may
//!   block any non-evasive attacker), which under-estimates our damage and thus
//!   prefers false negatives.
//! - Tapped / attacked-already state is not tracked; a creature that could not
//!   in fact attack may be counted, offset by the strict "defender survived"
//!   guard and the conservative blocking model.

use crate::{resolve_card, turn_phase_label, CheckContext, Finding};

use super::{entered_battlefield_names, has_keyword, is_creature, observed_power};

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    if ctx.carddb.is_none() {
        return findings;
    }

    for turn in &ctx.timeline.turns {
        let Some(active) = &turn.active_player else {
            continue;
        };

        // Exactly one living opponent (heads-up only).
        let opponents: Vec<&String> = turn
            .life_totals
            .keys()
            .filter(|player| *player != active)
            .collect();
        if opponents.len() != 1 {
            continue;
        }
        let defender = opponents[0];
        let Some(&defender_life) = turn.life_totals.get(defender) else {
            continue;
        };
        // Defender must be alive at end of turn: lethal was available but *not
        // taken*. A dead defender means the attack was in fact lethal.
        if defender_life <= 0 {
            continue;
        }

        let Some(active_zones) = turn.zones.get(active) else {
            continue;
        };
        let entered = entered_battlefield_names(turn);

        // (power, is_flying) for each eligible attacker.
        let mut attackers: Vec<(i64, bool)> = Vec::new();
        for object in &active_zones.battlefield {
            let Some(record) = resolve_card(ctx.carddb, &object.card_ref) else {
                continue;
            };
            if !is_creature(&record) {
                continue;
            }
            let summoning_sick =
                entered.contains(&record.name.to_lowercase()) && !has_keyword(&record, "Haste");
            if summoning_sick {
                continue;
            }
            let Some(power) = observed_power(ctx.timeline, &object.card_ref) else {
                continue;
            };
            attackers.push((power as i64, has_keyword(&record, "Flying")));
        }
        if attackers.is_empty() {
            continue;
        }

        let (blocker_count, defender_can_block_flyers) = defender_blockers(ctx, turn, defender);
        let guaranteed = guaranteed_damage(&attackers, blocker_count, defender_can_block_flyers);
        if guaranteed < defender_life || guaranteed == 0 {
            continue;
        }

        findings.push(ctx.suggestion(
            "lethal-available",
            turn.turn_number,
            turn_phase_label(turn),
            0.4,
            &[],
            format!(
                "On turn {}, player {active}'s board could have dealt at least {guaranteed} \
                 unblocked damage to {defender} (at {defender_life} life) — lethal appears to \
                 have been available but was not taken.",
                turn.turn_number
            ),
        ));
    }

    findings
}

/// Number of the defender's creatures and whether any of them can block a flyer
/// (has flying or reach).
fn defender_blockers(ctx: &CheckContext<'_>, turn: &core_gamestate::TurnSnapshot, defender: &str) -> (usize, bool) {
    let mut count = 0usize;
    let mut can_block_flyers = false;
    if let Some(zones) = turn.zones.get(defender) {
        for object in &zones.battlefield {
            if let Some(record) = resolve_card(ctx.carddb, &object.card_ref) {
                if is_creature(&record) {
                    count += 1;
                    if has_keyword(&record, "Flying") || has_keyword(&record, "Reach") {
                        can_block_flyers = true;
                    }
                }
            }
        }
    }
    (count, can_block_flyers)
}

/// Guaranteed damage the attackers deal if the defender blocks optimally to
/// minimise it: evasive flyers always connect, the rest are blocked
/// highest-power-first up to `blocker_count`.
fn guaranteed_damage(attackers: &[(i64, bool)], blocker_count: usize, defender_can_block_flyers: bool) -> i64 {
    let mut evasive_sum = 0i64;
    let mut blockable: Vec<i64> = Vec::new();
    for (power, flying) in attackers {
        if *flying && !defender_can_block_flyers {
            evasive_sum += *power;
        } else {
            blockable.push(*power);
        }
    }
    blockable.sort_unstable_by(|a, b| b.cmp(a));
    let blocked = blocker_count.min(blockable.len());
    let unblocked_sum: i64 = blockable.iter().skip(blocked).sum();
    evasive_sum + unblocked_sum
}
