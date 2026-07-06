//! `missed-trigger-hint` — a permanent with an apparently *mandatory*
//! enters-the-battlefield trigger entered the battlefield, but no corresponding
//! trigger was noted (CR 603 on triggered abilities). This is an `info`-severity,
//! low-confidence *hint*, not a violation claim.
//!
//! # Fire condition
//!
//! Needs a card DB. For each `ZoneTransfer` into the battlefield this turn whose
//! card resolves and whose oracle text looks like a mandatory ETB trigger (an
//! "enters"/"when(ever)" clause without "may"), raise an `info` hint if no
//! `TriggerNoted` action for that card was observed during the same turn.
//!
//! # Blind spots (documented, prefer false negatives)
//!
//! - Requires a card DB; without one the check never fires.
//! - Mandatory-vs-optional detection is a crude oracle-text heuristic: any
//!   "may" anywhere in the text suppresses the hint, and replacement effects
//!   ("enters the battlefield tapped") are excluded — so many real triggers are
//!   missed, which is why confidence is low and severity is only `info`.
//! - Correlation with an actual effect is by same-turn `TriggerNoted` on the
//!   same card name; a trigger logged differently, or one whose effect is
//!   invisible in the stream, is not credited.

use std::collections::BTreeSet;

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
        let noted = noted_triggers(turn);

        for timeline_action in &turn.actions {
            let TimelineAction::Parsed(GameAction::ZoneTransfer {
                card_ref: Some(card_ref),
                to_zone: Zone::Battlefield,
                ..
            }) = timeline_action
            else {
                continue;
            };
            let Some(record) = resolve_card(ctx.carddb, card_ref) else {
                continue;
            };
            if !has_mandatory_etb_trigger(&record) {
                continue;
            }

            let name_key = card_ref
                .name
                .clone()
                .unwrap_or_else(|| record.name.clone())
                .to_lowercase();
            if noted.contains(&name_key) {
                continue;
            }

            findings.push(ctx.rule_check(
                "missed-trigger-hint",
                turn.turn_number,
                turn_phase_label(turn),
                Severity::Info,
                0.2,
                &["CR 603"],
                format!(
                    "{} entered the battlefield on turn {} and appears to have a mandatory \
                     enter-the-battlefield trigger, but no matching trigger was noted — verify it \
                     was put on the stack.",
                    record.name, turn.turn_number
                ),
            ));
        }
    }

    findings
}

/// Lowercased card names that had a `TriggerNoted` action during this turn.
fn noted_triggers(turn: &TurnSnapshot) -> BTreeSet<String> {
    let mut noted = BTreeSet::new();
    for timeline_action in &turn.actions {
        if let TimelineAction::Parsed(GameAction::TriggerNoted { card_ref, .. }) = timeline_action {
            if let Some(card_ref) = card_ref {
                if let Some(name) = &card_ref.name {
                    noted.insert(name.to_lowercase());
                }
            }
        }
    }
    noted
}

/// Crude "mandatory ETB trigger" detector over oracle text.
fn has_mandatory_etb_trigger(record: &CardRecord) -> bool {
    let Some(text) = record.oracle_text.as_deref() else {
        return false;
    };
    let text = text.to_lowercase();
    let has_etb = text.contains("enters");
    let is_trigger = text.contains("when") || text.contains("whenever");
    let mandatory = !text.contains(" may ");
    let is_replacement_only = text.contains("enters the battlefield tapped") && !text.contains("when");
    has_etb && is_trigger && mandatory && !is_replacement_only
}
