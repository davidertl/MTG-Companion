//! `mana-impossible` — a spell whose mana cost strictly exceeds an *upper bound*
//! on the mana the caster could have produced from their untapped sources
//! (CR 601.2f–601.2h on activating mana abilities and paying a spell's costs).
//!
//! # Fire condition
//!
//! Needs a card DB. For each `CastSpell` whose card resolves and has a known
//! converted mana cost, compute a deliberately generous upper bound on the
//! caster's available mana: every permanent the caster controls at end of turn
//! that is a mana source is credited with [`MAX_MANA_PER_SOURCE`]. Only when the
//! spell's converted mana cost *strictly* exceeds even that inflated bound is a
//! `warning` raised — i.e. only when the cast is essentially impossible.
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Requires a card DB; without one the check never fires.
//! - If any of the caster's permanents cannot be identified in the card DB the
//!   check bails for that cast (unknown mana potential → stay silent).
//! - Rituals and other one-shot mana, cost reduction, alternative/added costs
//!   (convoke, delve, Phyrexian, "without paying its mana cost"), and mana from
//!   a permanent that left before end of turn are not modelled; each can make an
//!   apparently impossible cast legal, so the generous per-source credit and the
//!   strict `>` comparison keep this conservative.
//! - Uses the end-of-turn battlefield as the source pool, which over-counts
//!   sources relative to the moment of the cast — deliberately, to avoid false
//!   positives.

use core_domain::{CardRef, GameAction};
use core_carddb::CardRecord;
use core_gamestate::{PlayerZones, TimelineAction};

use crate::{resolve_card, turn_phase_label, CheckContext, Finding, Severity};

/// Generous per-source mana credit (covers most ramp lands and rocks). Larger
/// than a basic land's single mana on purpose, to prefer false negatives.
const MAX_MANA_PER_SOURCE: i64 = 3;

pub(crate) fn check(ctx: &CheckContext<'_>) -> Vec<Finding> {
    let mut findings = Vec::new();
    let Some(carddb) = ctx.carddb else {
        return findings;
    };

    for turn in &ctx.timeline.turns {
        for timeline_action in &turn.actions {
            let TimelineAction::Parsed(GameAction::CastSpell { actor, card_ref, .. }) =
                timeline_action
            else {
                continue;
            };
            let Some(card_ref) = card_ref else {
                continue;
            };
            let Some(record) = resolve_card(ctx.carddb, card_ref) else {
                continue;
            };
            let Some(cmc) = record.cmc else {
                continue;
            };
            let required = cmc.round() as i64;
            if required <= 0 {
                continue;
            }

            let Some(upper_bound) = mana_upper_bound(carddb, turn.zones.get(actor)) else {
                continue;
            };
            if required <= upper_bound {
                continue;
            }

            findings.push(ctx.rule_check(
                "mana-impossible",
                turn.turn_number,
                turn_phase_label(turn),
                Severity::Warning,
                0.5,
                &["CR 601.2"],
                format!(
                    "Player {actor} cast {} (mana value {required}) on turn {} but controlled \
                     mana sources able to produce at most {upper_bound}; the cast appears \
                     impossible from visible untapped sources.",
                    record.name, turn.turn_number
                ),
            ));
        }
    }

    findings
}

/// A generous upper bound on the mana the actor could produce from their
/// end-of-turn battlefield, or `None` if any controlled permanent cannot be
/// identified (in which case the check must not fire).
fn mana_upper_bound(carddb: &core_carddb::CardDb, zones: Option<&PlayerZones>) -> Option<i64> {
    let zones = zones?;
    let mut sources = 0i64;
    for object in &zones.battlefield {
        if object.card_ref == CardRef::default() {
            // Unknown permanent — its mana potential is uncertain.
            return None;
        }
        let record = resolve_card(Some(carddb), &object.card_ref)?;
        if is_mana_source(&record) {
            sources += 1;
        }
    }
    Some(sources * MAX_MANA_PER_SOURCE)
}

/// True when a card can plausibly produce mana: any land, or a permanent whose
/// rules text adds mana. Deliberately loose (over-counts sources → conservative).
fn is_mana_source(record: &CardRecord) -> bool {
    if record
        .type_line
        .as_deref()
        .map(|type_line| type_line.to_lowercase().contains("land"))
        .unwrap_or(false)
    {
        return true;
    }
    record
        .oracle_text
        .as_deref()
        .map(|text| text.to_lowercase().contains("add "))
        .unwrap_or(false)
}
