//! `unused-mana-with-play` — the active player ended their own turn with mana
//! available and a castable card sitting in their *known* hand.
//!
//! # Fire condition
//!
//! Needs a card DB. For a turn with a known active player who cast no spells
//! during the turn (so their mana sources went unspent), if they control at
//! least one mana source and their end-of-turn known hand holds a non-land card
//! whose mana value is within the number of controlled mana sources, raise an
//! `info` suggestion.
//!
//! # Hidden-information discipline (Arena local player only)
//!
//! Only the **known hand** is consulted — cards the engine observed entering a
//! hand with identity. An opponent's hand is counts-only, so this suggestion can
//! never fire for them; it fires only for the local player whose hand the engine
//! legitimately knows. See [`known_hands_per_turn`](super::known_hands_per_turn).
//!
//! # Blind spots (prefer false negatives)
//!
//! - Tap state is not tracked, so "unused mana" is approximated by *casting no
//!   spell that turn*: if the player cast nothing, their mana sources were
//!   necessarily unspent. This misses turns where a player cast a small spell
//!   yet floated enough for a bigger one — an accepted false negative.
//! - Each mana source is credited a single generic mana (no colour matching, no
//!   ramp), keeping the "castable" test conservative.
//! - Without a card DB the check never fires.

use crate::{resolve_card, turn_phase_label, CheckContext, Finding};

use super::{count_mana_sources, count_player_actions, is_land, known_hands_per_turn};
use core_domain::GameAction;

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    if ctx.carddb.is_none() {
        return findings;
    }

    let known_hands = known_hands_per_turn(ctx.timeline);

    for (index, turn) in ctx.timeline.turns.iter().enumerate() {
        let Some(active) = &turn.active_player else {
            continue;
        };

        let spells_cast =
            count_player_actions(turn, active, |action| matches!(action, GameAction::CastSpell { .. }));
        if spells_cast > 0 {
            continue;
        }

        let available_mana = count_mana_sources(ctx, turn.zones.get(active));
        if available_mana == 0 {
            continue;
        }

        let Some(hand) = known_hands.get(index).and_then(|hands| hands.get(active)) else {
            continue;
        };

        let castable = hand.iter().find_map(|card_ref| {
            let record = resolve_card(ctx.carddb, card_ref)?;
            if is_land(&record) {
                return None;
            }
            let cmc = record.cmc?;
            let required = cmc.round() as i64;
            if required >= 1 && required <= available_mana as i64 {
                Some(record.name)
            } else {
                None
            }
        });
        let Some(card_name) = castable else {
            continue;
        };

        findings.push(ctx.suggestion(
            "unused-mana-with-play",
            turn.turn_number,
            turn_phase_label(turn),
            0.4,
            &[],
            format!(
                "Player {active} ended turn {} with {available_mana} mana source(s) unspent and \
                 {card_name} castable in hand.",
                turn.turn_number
            ),
        ));
    }

    findings
}
