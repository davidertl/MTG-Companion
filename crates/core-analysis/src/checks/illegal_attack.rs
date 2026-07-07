//! `illegal-attack` — attacking with a creature that entered the battlefield
//! this turn and does not have haste (CR 302.6 "A creature's activated ability
//! with the tap symbol … can't be activated unless the creature has been under
//! that player's control continuously since their most recent turn began.
//! Similarly, a creature can't attack unless it has been under its controller's
//! control continuously since their most recent turn began", i.e. summoning
//! sickness, waived by haste).
//!
//! # Fire condition
//!
//! Needs a card DB (to confirm the attacker lacks haste). For each turn, collect
//! the creatures that entered the battlefield this turn (a `ZoneTransfer` into
//! the battlefield carrying a card name). For each declared attacker matching an
//! entered-this-turn creature by name, resolve it and raise a
//! `possible-violation` when it does not have haste.
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Requires a card DB; without one the check never fires (a hasty creature
//!   would otherwise be wrongly flagged).
//! - Haste granted by another permanent or a continuous effect is not modelled,
//!   nor is control being established on an earlier turn via blink/flicker of a
//!   same-named card.
//! - Entered-this-turn detection matches by card name, so it needs the entering
//!   `ZoneTransfer` and the attacker declaration to carry names; instance-only
//!   Arena identity is not correlated here (false negative).
//! - Because instance identity is not preserved at the action level, a name can
//!   be ambiguous when several copies of a creature are in play. To avoid
//!   FALSE POSITIVES on a legal attack with an older copy (e.g. attacking with a
//!   turn-1 Llanowar Elves while a second copy entered this turn), the check
//!   fires only when *every* same-named creature the attacker controls entered
//!   this turn — so the specific attacker provably lacked the control since its
//!   most recent turn began. When an older same-named copy could be the
//!   attacker, the check stays silent (false negative, per the plan's bias).

use std::collections::BTreeMap;

use core_domain::{GameAction, Zone};
use core_carddb::CardRecord;
use core_gamestate::{TimelineAction, TurnSnapshot};

use crate::{resolve_card, turn_phase_label, CheckContext, Finding, Severity};

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    if ctx.carddb.is_none() {
        return findings;
    }

    for turn in &ctx.timeline.turns {
        let entered = entered_this_turn(turn);
        if entered.is_empty() {
            continue;
        }

        for timeline_action in &turn.actions {
            let TimelineAction::Parsed(GameAction::DeclareAttackers { attackers, .. }) =
                timeline_action
            else {
                continue;
            };
            for attacker in attackers {
                let Some(card_ref) = &attacker.card_ref else {
                    continue;
                };
                let Some(name) = &card_ref.name else {
                    continue;
                };
                let lowered = name.to_lowercase();
                let entered_count = entered.get(&lowered).copied().unwrap_or(0);
                if entered_count == 0 {
                    continue;
                }
                // Ambiguity guard: if the attacker controls more same-named
                // creatures than entered this turn, an older (legal) copy could
                // be the one attacking. We cannot disambiguate by instance at
                // the action level, so stay silent rather than risk a false
                // positive on a legal attack.
                if battlefield_name_count(turn, &lowered) > entered_count {
                    continue;
                }
                let Some(record) = resolve_card(ctx.carddb, card_ref) else {
                    continue;
                };
                if has_haste(&record) {
                    continue;
                }

                findings.push(ctx.rule_check(
                    "illegal-attack",
                    turn.turn_number,
                    turn_phase_label(turn),
                    Severity::PossibleViolation,
                    0.7,
                    &["CR 302.6"],
                    format!(
                        "{} attacked on turn {} but appears to have entered the battlefield this \
                         turn without haste (summoning sickness).",
                        record.name, turn.turn_number
                    ),
                ));
            }
        }
    }

    findings
}

/// Count of creatures that entered the battlefield during this turn, keyed by
/// lowercased card name.
fn entered_this_turn(turn: &TurnSnapshot) -> BTreeMap<String, usize> {
    let mut entered: BTreeMap<String, usize> = BTreeMap::new();
    for timeline_action in &turn.actions {
        if let TimelineAction::Parsed(GameAction::ZoneTransfer {
            card_ref: Some(card_ref),
            to_zone: Zone::Battlefield,
            ..
        }) = timeline_action
        {
            if let Some(name) = &card_ref.name {
                *entered.entry(name.to_lowercase()).or_default() += 1;
            }
        }
    }
    entered
}

/// How many battlefield objects (across all players) carry the given lowercased
/// name at the end of this turn. Used to detect same-name ambiguity so a legal
/// attack with an older copy is never flagged.
fn battlefield_name_count(turn: &TurnSnapshot, lowered_name: &str) -> usize {
    turn.zones
        .values()
        .flat_map(|zones| zones.battlefield.iter())
        .filter(|object| {
            object
                .card_ref
                .name
                .as_deref()
                .map(|name| name.to_lowercase() == lowered_name)
                .unwrap_or(false)
        })
        .count()
}

fn has_haste(record: &CardRecord) -> bool {
    if record
        .keywords
        .iter()
        .any(|keyword| keyword.eq_ignore_ascii_case("Haste"))
    {
        return true;
    }
    record
        .oracle_text
        .as_deref()
        .map(|text| text.to_lowercase().contains("haste"))
        .unwrap_or(false)
}
