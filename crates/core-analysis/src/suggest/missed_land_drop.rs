//! `missed-land-drop` — the active player ended their turn with a playable land
//! still in their *known* hand and did not play a land that turn.
//!
//! # Fire condition
//!
//! Needs a card DB (to confirm a hand card is a land). For a turn with a known
//! active player, if that player played zero lands during the turn and their
//! end-of-turn known hand still contains a card that resolves to a land, raise
//! an `info` suggestion.
//!
//! # Hidden-information discipline
//!
//! Only the **known hand** (cards the engine observed entering a hand with
//! identity — see [`known_hands_per_turn`](super::known_hands_per_turn)) is
//! consulted. An opponent's hand is counts-only, so their known hand is always
//! empty and this suggestion can never fire for them. For Arena this means it
//! fires only for the local player whose draws carry identity.
//!
//! # Blind spots (prefer false negatives)
//!
//! - Without a card DB the check never fires (a hand card cannot be confirmed a
//!   land).
//! - Holding a land back can be correct (mana screw insurance, bluff, no need);
//!   this is a hint, not a rule, hence `info` severity and modest confidence.
//! - A land whose identity the engine never saw is invisible here.

use crate::{resolve_card, turn_phase_label, CheckContext, Finding};

use super::{count_player_actions, is_land, known_hands_per_turn};
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

        let lands_played =
            count_player_actions(turn, active, |action| matches!(action, GameAction::PlayLand { .. }));
        if lands_played > 0 {
            continue;
        }

        let Some(hand) = known_hands.get(index).and_then(|hands| hands.get(active)) else {
            continue;
        };
        let land_in_hand = hand.iter().any(|card_ref| {
            resolve_card(ctx.carddb, card_ref)
                .map(|record| is_land(&record))
                .unwrap_or(false)
        });
        if !land_in_hand {
            continue;
        }

        findings.push(ctx.suggestion(
            "missed-land-drop",
            turn.turn_number,
            turn_phase_label(turn),
            0.4,
            &["CR 305.2"],
            format!(
                "Player {active} did not play a land on turn {} but appears to still hold a \
                 playable land in hand.",
                turn.turn_number
            ),
        ));
    }

    findings
}
