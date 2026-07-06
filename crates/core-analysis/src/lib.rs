//! Deterministic rules checker for MancuTG-Companion (`core-analysis`, part 1).
//!
//! [`analyze`] maps a reconstructed [`GameTimeline`] (plus optional offline card
//! knowledge) to a list of [`Finding`]s — *hints for a human reviewer*, never
//! verdicts or autonomous rulings. It is a **pure function**: the card database
//! is passed in by reference, no file, clock, or network I/O happens inside the
//! engine, and the same input always yields the same findings in the same
//! order. This keeps every check fixture-testable and lets the desktop app call
//! it as a read-only projection.
//!
//! # Precision posture
//!
//! MTG's full rules are not deterministically checkable from logs: hidden
//! information, judgment calls, and text the engine has never seen make full
//! adjudication impossible. Every check here is therefore **high-precision /
//! low-recall**: it prefers *false negatives* over *false positives*, and a
//! check that would need information the timeline or card DB does not provide
//! must simply not fire. Each check module documents its own blind spots.
//!
//! # Finding contract
//!
//! [`Finding`] mirrors the frozen TS `analysisFindingSchema`
//! (`packages/shared-schema/src/analysis.ts`) field-for-field: serde renames
//! Rust `snake_case` to the schema's `camelCase`, the `kind`/`severity`/
//! `audience` enums serialize to the schema's kebab-case string unions, and
//! [`ENGINE_VERSION`] stamps every finding. All W3.1 findings are
//! `kind: "rule-check"` with severity at most `possible-violation`.

use core_carddb::{CardDb, CardRecord};
use core_domain::CardRef;
use core_gamestate::{GameTimeline, TimelineAction, TurnSnapshot};
use serde::{Deserialize, Serialize};

mod checks;

/// Version stamp written onto every [`Finding::engine_version`]. Bump when a
/// check's semantics change so downstream consumers can tell engines apart.
pub const ENGINE_VERSION: &str = "core-analysis/0.1.0";

/// `gameKey` used by the pure [`analyze`] entry point. The desktop read model
/// (`analyze_match`) calls [`analyze_with_game_key`] with the real match id
/// instead, so findings persisted into the event store are grouped correctly.
pub const DEFAULT_GAME_KEY: &str = "local";

/// Finding category. All W3.1 checks are [`FindingKind::RuleCheck`]; the
/// suggestion engine (W3.2) uses [`FindingKind::Suggestion`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FindingKind {
    RuleCheck,
    Suggestion,
}

/// Finding severity, ordered from least to most serious. Rule-check findings
/// never exceed [`Severity::PossibleViolation`] — the engine flags *possible*
/// breaks, and the human review step is the authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Info,
    Warning,
    PossibleViolation,
}

/// Who a finding may be shown to. Defaults to [`Audience::Players`]; the
/// referee-only routing (W3.3) enforces the tournament-scoped visibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Audience {
    Players,
    RefereeOnly,
    All,
}

/// One analysis finding, mirroring the frozen TS `analysisFindingSchema`
/// field-for-field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub finding_id: String,
    pub game_key: String,
    pub turn_number: u32,
    pub phase: String,
    pub kind: FindingKind,
    pub code: String,
    pub severity: Severity,
    pub confidence: f64,
    pub rule_refs: Vec<String>,
    pub description: String,
    pub audience: Audience,
    pub engine_version: String,
}

/// Read-only inputs shared by every check.
pub(crate) struct CheckContext<'a> {
    pub timeline: &'a GameTimeline,
    pub carddb: Option<&'a CardDb>,
    pub game_key: &'a str,
}

impl CheckContext<'_> {
    /// Builds a rule-check [`Finding`], filling in the fields that are constant
    /// across a check invocation (`game_key`, `kind`, `audience`,
    /// `engine_version`). `finding_id` is assigned centrally afterwards.
    pub(crate) fn rule_check(
        &self,
        code: &str,
        turn_number: u32,
        phase: String,
        severity: Severity,
        confidence: f64,
        rule_refs: &[&str],
        description: String,
    ) -> Finding {
        Finding {
            finding_id: String::new(),
            game_key: self.game_key.to_owned(),
            turn_number,
            phase: if phase.is_empty() {
                "unknown".to_owned()
            } else {
                phase
            },
            kind: FindingKind::RuleCheck,
            code: code.to_owned(),
            severity,
            confidence,
            rule_refs: rule_refs.iter().map(|reference| (*reference).to_owned()).collect(),
            description,
            audience: Audience::Players,
            engine_version: ENGINE_VERSION.to_owned(),
        }
    }
}

/// Analyze a timeline with the default game key. Pure; see [`analyze_with_game_key`].
pub fn analyze(timeline: &GameTimeline, carddb: Option<&CardDb>) -> Vec<Finding> {
    analyze_with_game_key(timeline, carddb, DEFAULT_GAME_KEY)
}

/// Analyze a timeline, stamping every finding with `game_key`.
///
/// Checks run in a fixed order and each walks the timeline turn-by-turn in
/// stored order, so the returned vector is deterministic (same input → identical
/// findings, identical ordering). `finding_id`s are assigned last from each
/// finding's position, so they are stable and unique per call.
pub fn analyze_with_game_key(
    timeline: &GameTimeline,
    carddb: Option<&CardDb>,
    game_key: &str,
) -> Vec<Finding> {
    let ctx = CheckContext {
        timeline,
        carddb,
        game_key,
    };

    let mut findings = Vec::new();
    findings.extend(checks::extra_land_drop::check(&ctx));
    findings.extend(checks::timing_violation::check(&ctx));
    findings.extend(checks::sba_lethal_damage::check(&ctx));
    findings.extend(checks::mana_impossible::check(&ctx));
    findings.extend(checks::illegal_attack::check(&ctx));
    findings.extend(checks::missed_trigger_hint::check(&ctx));

    for (index, finding) in findings.iter_mut().enumerate() {
        finding.finding_id = format!(
            "{}:{}:t{}:{}",
            game_key, finding.code, finding.turn_number, index
        );
    }
    findings
}

// --- shared check helpers -------------------------------------------------

/// The phase in effect for one parsed action, derived by threading
/// `PhaseChanged` actions through a turn's action list in order.
pub(crate) struct PhasedAction<'a> {
    pub phase: Option<String>,
    pub action: &'a core_domain::GameAction,
}

/// Walk a turn's parsed actions, annotating each with the phase in effect at
/// that point. Phase is unknown (`None`) until the first `PhaseChanged` within
/// the turn is observed — checks that need the phase must treat `None` as "not
/// enough information" and stay silent.
pub(crate) fn phased_actions(turn: &TurnSnapshot) -> Vec<PhasedAction<'_>> {
    let mut phase: Option<String> = None;
    let mut out = Vec::new();
    for timeline_action in &turn.actions {
        if let TimelineAction::Parsed(action) = timeline_action {
            if let core_domain::GameAction::PhaseChanged { phase: new_phase, .. } = action {
                phase = Some(new_phase.clone());
            }
            out.push(PhasedAction {
                phase: phase.clone(),
                action,
            });
        }
    }
    out
}

/// Resolve a [`CardRef`] against the card DB — by Arena id first, then by name.
/// Returns `None` when there is no card DB, the ref carries no usable
/// identifier, the card is absent, or a lookup errors (checks then stay silent).
pub(crate) fn resolve_card(carddb: Option<&CardDb>, card_ref: &CardRef) -> Option<CardRecord> {
    let db = carddb?;
    if let Some(arena_id) = card_ref.arena_id {
        if let Ok(Some(record)) = db.lookup_by_arena_id(arena_id) {
            return Some(record);
        }
    }
    if let Some(name) = &card_ref.name {
        if let Ok(Some(record)) = db.lookup_by_name(name) {
            return Some(record);
        }
    }
    None
}

/// True when the card record carries flash (as a keyword or in its rules text),
/// so it may legally be cast at instant speed.
pub(crate) fn has_flash(record: &CardRecord) -> bool {
    if record
        .keywords
        .iter()
        .any(|keyword| keyword.eq_ignore_ascii_case("Flash"))
    {
        return true;
    }
    record
        .oracle_text
        .as_deref()
        .map(|text| text.to_lowercase().contains("flash"))
        .unwrap_or(false)
}

/// The phase to stamp onto a finding raised for `turn`, never empty.
pub(crate) fn turn_phase_label(turn: &TurnSnapshot) -> String {
    turn.phase.clone().unwrap_or_else(|| "unknown".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finding_serializes_to_the_frozen_schema_shape() {
        let ctx = CheckContext {
            timeline: &GameTimeline {
                turns: vec![],
                completeness: core_gamestate::Completeness::Complete,
                notes: vec![],
            },
            carddb: None,
            game_key: "match-1",
        };
        let mut finding = ctx.rule_check(
            "extra-land-drop",
            3,
            "main1".to_owned(),
            Severity::PossibleViolation,
            0.6,
            &["CR 305.2"],
            "example".to_owned(),
        );
        finding.finding_id = "match-1:extra-land-drop:t3:0".to_owned();

        let value = serde_json::to_value(&finding).expect("finding serializes");
        assert_eq!(
            value,
            json!({
                "findingId": "match-1:extra-land-drop:t3:0",
                "gameKey": "match-1",
                "turnNumber": 3,
                "phase": "main1",
                "kind": "rule-check",
                "code": "extra-land-drop",
                "severity": "possible-violation",
                "confidence": 0.6,
                "ruleRefs": ["CR 305.2"],
                "description": "example",
                "audience": "players",
                "engineVersion": ENGINE_VERSION,
            })
        );
    }
}
