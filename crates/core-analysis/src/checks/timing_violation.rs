//! `timing-violation` — a sorcery-speed spell cast at instant timing
//! (CR 307.1 "A player may cast a sorcery spell only during a main phase of
//! their turn when they have priority"; CR 117.1a on when sorcery-speed actions
//! are legal).
//!
//! # Fire condition
//!
//! Needs a card DB. For each `CastSpell` whose card resolves and is
//! sorcery-speed (not an instant, and without flash), raise a
//! `possible-violation` when either:
//! - the caster is not the active player (a sorcery can only be cast on one's
//!   own turn), or
//! - the cast happened in a phase/step the engine can positively identify as a
//!   non-main phase (combat, upkeep, end step, etc.).
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Requires a card DB; without one the check never fires.
//! - Flash granted by another permanent/effect, or alternative instant-speed
//!   casting permissions, are not modelled — such a "violation" is a real blind
//!   spot but only ever produces a false *positive* if the caster is also
//!   off-turn/off-phase, which is why both signals are conservative.
//! - Phase identification is string-based: a cast whose phase the timeline never
//!   reported, or whose phase label the engine does not recognise, is treated as
//!   "unknown timing" and does not fire on the phase signal.
//! - Split cards, MDFCs, and cards absent from the card DB are not analysed.

use core_domain::GameAction;
use core_carddb::CardRecord;

use crate::{has_flash, phased_actions, resolve_card, CheckContext, Finding, Severity};

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    if ctx.carddb.is_none() {
        return findings;
    }

    for turn in &ctx.timeline.turns {
        let active_player = turn.active_player.as_deref();

        for phased in phased_actions(turn) {
            let GameAction::CastSpell {
                actor, card_ref, ..
            } = phased.action
            else {
                continue;
            };
            let Some(card_ref) = card_ref else {
                continue;
            };
            let Some(record) = resolve_card(ctx.carddb, card_ref) else {
                continue;
            };
            if !is_sorcery_speed(&record) {
                continue;
            }

            let off_turn = active_player
                .map(|active| active != actor.as_str())
                .unwrap_or(false);
            let phase_label = phased.phase.clone();
            let off_phase = phase_label
                .as_deref()
                .map(is_non_main_phase)
                .unwrap_or(false);

            if !off_turn && !off_phase {
                continue;
            }

            let reason = if off_turn {
                format!(
                    "sorcery-speed spell {} was cast by {actor} on turn {} (active player: {})",
                    record.name,
                    turn.turn_number,
                    active_player.unwrap_or("unknown"),
                )
            } else {
                format!(
                    "sorcery-speed spell {} was cast during {} on turn {}",
                    record.name,
                    phase_label.as_deref().unwrap_or("a non-main phase"),
                    turn.turn_number,
                )
            };

            findings.push(ctx.rule_check(
                "timing-violation",
                turn.turn_number,
                phase_label.unwrap_or_else(|| "unknown".to_owned()),
                Severity::PossibleViolation,
                0.7,
                &["CR 307.1", "CR 117.1a"],
                format!(
                    "Possible timing violation: {reason}. Sorcery-speed spells may normally \
                     only be cast during the caster's own main phase with an empty stack."
                ),
            ));
        }
    }

    findings
}

/// A spell is sorcery-speed when it is a castable spell type that is neither an
/// instant nor has flash. Lands are excluded (they are played, not cast).
fn is_sorcery_speed(record: &CardRecord) -> bool {
    let Some(type_line) = record.type_line.as_deref() else {
        return false;
    };
    let type_line = type_line.to_lowercase();
    if type_line.contains("instant") || type_line.contains("land") {
        return false;
    }
    if has_flash(record) {
        return false;
    }
    ["sorcery", "creature", "artifact", "enchantment", "planeswalker", "battle"]
        .iter()
        .any(|spell_type| type_line.contains(spell_type))
}

/// True when a phase/step label is positively recognised as a non-main phase.
/// Unknown labels return `false` so the check stays silent on unclear timing.
fn is_non_main_phase(phase: &str) -> bool {
    let phase = phase.to_lowercase();
    if phase.contains("main") {
        return false;
    }
    [
        "combat", "upkeep", "draw", "end", "beginning", "untap", "cleanup", "declare", "attack",
        "block",
    ]
    .iter()
    .any(|marker| phase.contains(marker))
}
