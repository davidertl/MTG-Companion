//! Shared domain vocabulary for MancuTG-Companion.
//!
//! # Event label table
//!
//! `EventType` variants are persisted by their stable string label (the
//! `event_type` column in the local event store). Labels are append-only:
//! existing labels MUST NEVER be renamed, because stored rows depend on them.
//! The Arena parser (`core-parser`) and the PaperC action mapping both cite
//! this table as the single source of truth.
//!
//! | `EventType` variant   | Stored label          | Meaning                                            |
//! |-----------------------|-----------------------|----------------------------------------------------|
//! | `MatchStart`          | `MATCH_START`         | A match (Bo1/Bo3 room) began                       |
//! | `MatchEnd`            | `MATCH_END`           | A match completed                                  |
//! | `CollectionSnapshot`  | `COLLECTION_SNAPSHOT` | Card collection totals observed                    |
//! | `InventorySnapshot`   | `INVENTORY_SNAPSHOT`  | Wallet/wildcard/vault totals observed              |
//! | `DraftPick`           | `DRAFT_PICK`          | A draft pick was made                              |
//! | `GameStart`           | `GAME_START`          | An individual game within a match began            |
//! | `GameEnd`             | `GAME_END`            | An individual game within a match ended            |
//! | `TurnBegin`           | `TURN_BEGIN`          | A new turn began                                   |
//! | `PhaseChange`         | `PHASE_CHANGE`        | Phase/step changed                                 |
//! | `PriorityPass`        | `PRIORITY_PASS`       | A player passed priority                           |
//! | `CardCast`            | `CARD_CAST`           | A spell was cast                                   |
//! | `LandPlayed`          | `LAND_PLAYED`         | A land was played                                  |
//! | `AbilityActivated`    | `ABILITY_ACTIVATED`   | An activated ability was activated                 |
//! | `TriggerFired`        | `TRIGGER_FIRED`       | A triggered ability went on the stack / was noted  |
//! | `ZoneTransfer`        | `ZONE_TRANSFER`       | An object moved between zones                      |
//! | `AttackersDeclared`   | `ATTACKERS_DECLARED`  | Attackers were declared                            |
//! | `BlockersDeclared`    | `BLOCKERS_DECLARED`   | Blockers were declared                             |
//! | `DamageDealt`         | `DAMAGE_DEALT`        | Damage was dealt                                   |
//! | `LifeChanged`         | `LIFE_CHANGED`        | A player's life total changed                      |
//! | `MulliganDecision`    | `MULLIGAN_DECISION`   | Keep/mulligan decision was made                    |
//! | `Unknown(label)`      | *(label verbatim)*    | Catch-all for unrecognized labels (lossy funnel)   |
//!
//! # Payload carriage
//!
//! `NormalizedEvent.payload` is a structured [`serde_json::Value`]. Producers
//! that only have flat `key=value` data can use [`flat_payload`] to build a
//! JSON object of strings — the shape legacy store rows already use, so old
//! and new payloads read through the same code path. Gameplay events carry a
//! serialized [`GameAction`] (conventionally under the `"action"` key, next
//! to source-specific raw identifiers such as `grpId`/`instanceId`).
//!
//! # GameAction vocabulary
//!
//! [`GameAction`] is the shared action vocabulary for Arena-sourced and
//! paper-sourced gameplay streams. It mirrors the TS `gameActions` contract
//! (`packages/shared-schema/src/gameActions.ts`) field-for-field: Rust fields
//! are `snake_case` and serde-renamed to `camelCase` for JSON parity, and the
//! discriminator is the internally tagged `"action"` field with camelCase
//! variant names (`playLand`, `castSpell`, `activateAbility`, `triggerNoted`,
//! `declareAttackers`, `declareBlockers`, `damageDealt`, `lifeChanged`,
//! `zoneTransfer`, `mulliganDecision`, `turnBegan`, `phaseChanged`,
//! `priorityPassed`, `gameStarted`, `gameEnded`, `manualNote`, `undoApplied`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformTag {
    Desktop,
    Ios,
}

impl PlatformTag {
    pub fn label(&self) -> &str {
        match self {
            Self::Desktop => "desktop",
            Self::Ios => "ios",
        }
    }

    pub fn from_label(label: &str) -> Self {
        match label {
            "ios" => Self::Ios,
            _ => Self::Desktop,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImportSourceKind {
    LiveWatch,
    DragAndDrop,
    FolderImport,
}

impl ImportSourceKind {
    pub fn label(&self) -> &str {
        match self {
            Self::LiveWatch => "live-watch",
            Self::DragAndDrop => "drag-and-drop",
            Self::FolderImport => "folder-import",
        }
    }

    pub fn from_label(label: &str) -> Self {
        match label {
            "drag-and-drop" => Self::DragAndDrop,
            "folder-import" => Self::FolderImport,
            _ => Self::LiveWatch,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSession {
    pub session_id: String,
    pub platform_tag: PlatformTag,
    pub source_kind: ImportSourceKind,
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawChunk {
    pub session_id: String,
    pub offset: u64,
    pub sha256: String,
    pub raw_text: String,
}

/// Typed event kinds. See the label table in the module docs — labels are the
/// persisted representation and are append-only/stable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum EventType {
    MatchStart,
    MatchEnd,
    CollectionSnapshot,
    InventorySnapshot,
    DraftPick,
    GameStart,
    GameEnd,
    TurnBegin,
    PhaseChange,
    PriorityPass,
    CardCast,
    LandPlayed,
    AbilityActivated,
    TriggerFired,
    ZoneTransfer,
    AttackersDeclared,
    BlockersDeclared,
    DamageDealt,
    LifeChanged,
    MulliganDecision,
    Unknown(String),
}

impl EventType {
    pub fn from_label(label: &str) -> Self {
        match label {
            "MATCH_START" => Self::MatchStart,
            "MATCH_END" => Self::MatchEnd,
            "COLLECTION_SNAPSHOT" => Self::CollectionSnapshot,
            "INVENTORY_SNAPSHOT" => Self::InventorySnapshot,
            "DRAFT_PICK" => Self::DraftPick,
            "GAME_START" => Self::GameStart,
            "GAME_END" => Self::GameEnd,
            "TURN_BEGIN" => Self::TurnBegin,
            "PHASE_CHANGE" => Self::PhaseChange,
            "PRIORITY_PASS" => Self::PriorityPass,
            "CARD_CAST" => Self::CardCast,
            "LAND_PLAYED" => Self::LandPlayed,
            "ABILITY_ACTIVATED" => Self::AbilityActivated,
            "TRIGGER_FIRED" => Self::TriggerFired,
            "ZONE_TRANSFER" => Self::ZoneTransfer,
            "ATTACKERS_DECLARED" => Self::AttackersDeclared,
            "BLOCKERS_DECLARED" => Self::BlockersDeclared,
            "DAMAGE_DEALT" => Self::DamageDealt,
            "LIFE_CHANGED" => Self::LifeChanged,
            "MULLIGAN_DECISION" => Self::MulliganDecision,
            other => Self::Unknown(other.to_owned()),
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::MatchStart => "MATCH_START",
            Self::MatchEnd => "MATCH_END",
            Self::CollectionSnapshot => "COLLECTION_SNAPSHOT",
            Self::InventorySnapshot => "INVENTORY_SNAPSHOT",
            Self::DraftPick => "DRAFT_PICK",
            Self::GameStart => "GAME_START",
            Self::GameEnd => "GAME_END",
            Self::TurnBegin => "TURN_BEGIN",
            Self::PhaseChange => "PHASE_CHANGE",
            Self::PriorityPass => "PRIORITY_PASS",
            Self::CardCast => "CARD_CAST",
            Self::LandPlayed => "LAND_PLAYED",
            Self::AbilityActivated => "ABILITY_ACTIVATED",
            Self::TriggerFired => "TRIGGER_FIRED",
            Self::ZoneTransfer => "ZONE_TRANSFER",
            Self::AttackersDeclared => "ATTACKERS_DECLARED",
            Self::BlockersDeclared => "BLOCKERS_DECLARED",
            Self::DamageDealt => "DAMAGE_DEALT",
            Self::LifeChanged => "LIFE_CHANGED",
            Self::MulliganDecision => "MULLIGAN_DECISION",
            Self::Unknown(label) => label.as_str(),
        }
    }
}

/// Reference to a card, unifying Arena identifiers and paper name entry.
/// Mirrors the TS `cardRef` shape: `{ name?, arenaId?, scryfallOracleId? }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CardRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arena_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scryfall_oracle_id: Option<String>,
}

/// Game zones for `zone_from`/`zone_to` on [`GameAction`]s.
/// Serialized as camelCase strings (`"library"`, `"battlefield"`, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Zone {
    Library,
    Hand,
    Battlefield,
    Graveyard,
    Exile,
    Stack,
    Command,
    Sideboard,
    Unknown,
}

/// A target of an action: a player, a card/object, or a zone (e.g. damage to
/// a planeswalker controller). Mirrors TS `gameActionTargetSchema`:
/// `{ playerRef?, objectRef?, cardRef?, zoneRef? }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub player_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_ref: Option<CardRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone_ref: Option<Zone>,
}

/// A creature participating in combat. Mirrors TS `combatantSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Combatant {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_ref: Option<CardRef>,
}

/// An attacker plus what it attacks. Mirrors the TS `declareAttackers`
/// attacker entry (`combatant + defendingTarget?`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttackerDeclaration {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_ref: Option<CardRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defending_target: Option<ActionTarget>,
}

/// A blocker plus which attacker it blocks. Mirrors the TS `declareBlockers`
/// blocker entry (`combatant + blockedAttacker?`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockerDeclaration {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_ref: Option<CardRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_attacker: Option<Combatant>,
}

/// Keep-or-mulligan decision. Mirrors TS `z.enum(["keep", "mulligan"])`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MulliganChoice {
    Keep,
    Mulligan,
}

/// Game outcome for `gameEnded`. Mirrors TS `z.enum(["win", "draw", "unknown"])`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameOutcome {
    Win,
    Draw,
    Unknown,
}

/// Shared gameplay action vocabulary for Arena-sourced and paper-sourced
/// streams. Serialized internally tagged on `"type"` with camelCase variant
/// names and camelCase fields, mirroring the TS `gameActions` contract
/// (`packages/shared-schema/src/gameActions.ts`) field-for-field.
/// `actor` is the acting player's identifier (seat id or name); every
/// variant also carries the TS base's optional `cardRef`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GameAction {
    PlayLand {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_zone: Option<Zone>,
    },
    CastSpell {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_zone: Option<Zone>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        targets: Vec<ActionTarget>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mana_spent: Option<String>,
    },
    ActivateAbility {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ability_text: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        targets: Vec<ActionTarget>,
    },
    TriggerNoted {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        trigger_text: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        targets: Vec<ActionTarget>,
    },
    DeclareAttackers {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attackers: Vec<AttackerDeclaration>,
    },
    DeclareBlockers {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        blockers: Vec<BlockerDeclaration>,
    },
    DamageDealt {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        amount: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        targets: Vec<ActionTarget>,
    },
    LifeChanged {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        player_ref: String,
        delta: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        new_total: Option<i64>,
    },
    ZoneTransfer {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        from_zone: Zone,
        to_zone: Zone,
    },
    MulliganDecision {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        decision: MulliganChoice,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hand_size: Option<u8>,
    },
    TurnBegan {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        turn_number: u32,
    },
    PhaseChanged {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        phase: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step: Option<String>,
    },
    PriorityPassed {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
    },
    GameStarted {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        players: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_the_play: Option<String>,
    },
    GameEnded {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        winner_ref: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        outcome: Option<GameOutcome>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    ManualNote {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        note: String,
    },
    UndoApplied {
        actor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        card_ref: Option<CardRef>,
        undone_event_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

impl GameAction {
    /// The camelCase discriminator used in the serialized `"type"` tag,
    /// identical to the TS `gameActions` kind names.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::PlayLand { .. } => "playLand",
            Self::CastSpell { .. } => "castSpell",
            Self::ActivateAbility { .. } => "activateAbility",
            Self::TriggerNoted { .. } => "triggerNoted",
            Self::DeclareAttackers { .. } => "declareAttackers",
            Self::DeclareBlockers { .. } => "declareBlockers",
            Self::DamageDealt { .. } => "damageDealt",
            Self::LifeChanged { .. } => "lifeChanged",
            Self::ZoneTransfer { .. } => "zoneTransfer",
            Self::MulliganDecision { .. } => "mulliganDecision",
            Self::TurnBegan { .. } => "turnBegan",
            Self::PhaseChanged { .. } => "phaseChanged",
            Self::PriorityPassed { .. } => "priorityPassed",
            Self::GameStarted { .. } => "gameStarted",
            Self::GameEnded { .. } => "gameEnded",
            Self::ManualNote { .. } => "manualNote",
            Self::UndoApplied { .. } => "undoApplied",
        }
    }

    /// The acting player's identifier.
    pub fn actor(&self) -> &str {
        match self {
            Self::PlayLand { actor, .. }
            | Self::CastSpell { actor, .. }
            | Self::ActivateAbility { actor, .. }
            | Self::TriggerNoted { actor, .. }
            | Self::DeclareAttackers { actor, .. }
            | Self::DeclareBlockers { actor, .. }
            | Self::DamageDealt { actor, .. }
            | Self::LifeChanged { actor, .. }
            | Self::ZoneTransfer { actor, .. }
            | Self::MulliganDecision { actor, .. }
            | Self::TurnBegan { actor, .. }
            | Self::PhaseChanged { actor, .. }
            | Self::PriorityPassed { actor, .. }
            | Self::GameStarted { actor, .. }
            | Self::GameEnded { actor, .. }
            | Self::ManualNote { actor, .. }
            | Self::UndoApplied { actor, .. } => actor,
        }
    }
}

/// A normalized event with a structured JSON payload.
///
/// Legacy rows (and simple producers) carry a flat JSON object of strings
/// (see [`flat_payload`]); gameplay events carry nested structures such as a
/// serialized [`GameAction`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedEvent {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub event_type: EventType,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseReport {
    pub raw_chunks: Vec<RawChunk>,
    pub events: Vec<NormalizedEvent>,
    pub next_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchRecord {
    pub match_id: String,
    pub deck: String,
    pub result: Option<String>,
    pub queue: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionSnapshot {
    pub cards_owned: u32,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventorySnapshot {
    pub gold: u32,
    pub gems: u32,
    pub wildcards: u32,
    pub vault: u32,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftPick {
    pub set_code: String,
    pub pack_number: u8,
    pub pick_number: u8,
    pub choice: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncObject {
    pub object_type: String,
    pub object_id: String,
    pub payload: serde_json::Value,
    pub dirty: bool,
    pub last_error: Option<String>,
}

/// Build a flat JSON-object payload from `key=value` string pairs — the shape
/// legacy store rows use, kept for simple producers and backward compat.
pub fn flat_payload(pairs: BTreeMap<String, String>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key, Value::String(value)))
            .collect(),
    )
}

/// Read a top-level payload field as a string. Scalars (string, number, bool)
/// are stringified; nested objects/arrays yield `None`. This preserves the
/// lookup semantics projections relied on when payloads were flat string maps.
pub fn payload_value(payload: &Value, key: &str) -> Option<String> {
    match payload.get(key)? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_type_labels_round_trip_for_every_variant() {
        let variants = [
            (EventType::MatchStart, "MATCH_START"),
            (EventType::MatchEnd, "MATCH_END"),
            (EventType::CollectionSnapshot, "COLLECTION_SNAPSHOT"),
            (EventType::InventorySnapshot, "INVENTORY_SNAPSHOT"),
            (EventType::DraftPick, "DRAFT_PICK"),
            (EventType::GameStart, "GAME_START"),
            (EventType::GameEnd, "GAME_END"),
            (EventType::TurnBegin, "TURN_BEGIN"),
            (EventType::PhaseChange, "PHASE_CHANGE"),
            (EventType::PriorityPass, "PRIORITY_PASS"),
            (EventType::CardCast, "CARD_CAST"),
            (EventType::LandPlayed, "LAND_PLAYED"),
            (EventType::AbilityActivated, "ABILITY_ACTIVATED"),
            (EventType::TriggerFired, "TRIGGER_FIRED"),
            (EventType::ZoneTransfer, "ZONE_TRANSFER"),
            (EventType::AttackersDeclared, "ATTACKERS_DECLARED"),
            (EventType::BlockersDeclared, "BLOCKERS_DECLARED"),
            (EventType::DamageDealt, "DAMAGE_DEALT"),
            (EventType::LifeChanged, "LIFE_CHANGED"),
            (EventType::MulliganDecision, "MULLIGAN_DECISION"),
        ];

        for (variant, label) in variants {
            assert_eq!(variant.label(), label);
            assert_eq!(EventType::from_label(label), variant);
        }

        let unknown = EventType::from_label("PATCH_SPECIFIC_EVENT");
        assert_eq!(unknown, EventType::Unknown("PATCH_SPECIFIC_EVENT".to_owned()));
        assert_eq!(unknown.label(), "PATCH_SPECIFIC_EVENT");
    }

    #[test]
    fn game_action_serializes_with_camel_case_tag_and_fields() {
        let action = GameAction::CastSpell {
            actor: "player-1".to_owned(),
            card_ref: Some(CardRef {
                name: Some("Lightning Strike".to_owned()),
                arena_id: Some(91234),
                scryfall_oracle_id: None,
            }),
            from_zone: Some(Zone::Hand),
            targets: vec![ActionTarget {
                player_ref: Some("player-2".to_owned()),
                ..ActionTarget::default()
            }],
            mana_spent: Some("{1}{R}".to_owned()),
        };

        let serialized = serde_json::to_value(&action).expect("action should serialize");
        assert_eq!(
            serialized,
            json!({
                "type": "castSpell",
                "actor": "player-1",
                "cardRef": { "name": "Lightning Strike", "arenaId": 91234 },
                "fromZone": "hand",
                "targets": [{ "playerRef": "player-2" }],
                "manaSpent": "{1}{R}"
            })
        );

        let deserialized: GameAction =
            serde_json::from_value(serialized).expect("action should deserialize");
        assert_eq!(deserialized, action);
        assert_eq!(deserialized.kind(), "castSpell");
        assert_eq!(deserialized.actor(), "player-1");
    }

    #[test]
    fn every_game_action_kind_round_trips_through_json() {
        let card = || {
            Some(CardRef {
                name: Some("Grizzly Bears".to_owned()),
                arena_id: None,
                scryfall_oracle_id: Some("oracle-1".to_owned()),
            })
        };
        let actions = vec![
            GameAction::PlayLand {
                actor: "p1".into(),
                card_ref: card(),
                from_zone: Some(Zone::Hand),
            },
            GameAction::CastSpell {
                actor: "p1".into(),
                card_ref: card(),
                from_zone: Some(Zone::Hand),
                targets: vec![],
                mana_spent: None,
            },
            GameAction::ActivateAbility {
                actor: "p1".into(),
                card_ref: card(),
                ability_text: Some("{T}: Add {G}.".into()),
                targets: vec![],
            },
            GameAction::TriggerNoted {
                actor: "p1".into(),
                card_ref: card(),
                trigger_text: Some("upkeep trigger".into()),
                targets: vec![],
            },
            GameAction::DeclareAttackers {
                actor: "p1".into(),
                card_ref: None,
                attackers: vec![AttackerDeclaration {
                    card_ref: card(),
                    defending_target: Some(ActionTarget {
                        player_ref: Some("p2".into()),
                        ..ActionTarget::default()
                    }),
                    ..AttackerDeclaration::default()
                }],
            },
            GameAction::DeclareBlockers {
                actor: "p2".into(),
                card_ref: None,
                blockers: vec![BlockerDeclaration {
                    card_ref: card(),
                    blocked_attacker: Some(Combatant {
                        object_ref: Some("obj-7".into()),
                        card_ref: None,
                    }),
                    ..BlockerDeclaration::default()
                }],
            },
            GameAction::DamageDealt {
                actor: "p1".into(),
                card_ref: card(),
                amount: 2,
                targets: vec![ActionTarget {
                    player_ref: Some("p2".into()),
                    ..ActionTarget::default()
                }],
            },
            GameAction::LifeChanged {
                actor: "p2".into(),
                card_ref: None,
                player_ref: "p2".into(),
                delta: -2,
                new_total: Some(18),
            },
            GameAction::ZoneTransfer {
                actor: "p1".into(),
                card_ref: card(),
                from_zone: Zone::Battlefield,
                to_zone: Zone::Graveyard,
            },
            GameAction::MulliganDecision {
                actor: "p1".into(),
                card_ref: None,
                decision: MulliganChoice::Mulligan,
                hand_size: Some(6),
            },
            GameAction::TurnBegan {
                actor: "p1".into(),
                card_ref: None,
                turn_number: 3,
            },
            GameAction::PhaseChanged {
                actor: "p1".into(),
                card_ref: None,
                phase: "combat".into(),
                step: Some("declareAttackers".into()),
            },
            GameAction::PriorityPassed {
                actor: "p1".into(),
                card_ref: None,
            },
            GameAction::GameStarted {
                actor: "p1".into(),
                card_ref: None,
                players: vec!["p1".into(), "p2".into()],
                on_the_play: Some("p1".into()),
            },
            GameAction::GameEnded {
                actor: "p1".into(),
                card_ref: None,
                winner_ref: Some("p1".into()),
                outcome: Some(GameOutcome::Win),
                reason: Some("combat damage".into()),
            },
            GameAction::ManualNote {
                actor: "p2".into(),
                card_ref: None,
                note: "judge called".into(),
            },
            GameAction::UndoApplied {
                actor: "p2".into(),
                card_ref: None,
                undone_event_id: "evt-41".into(),
                reason: Some("misclick".into()),
            },
        ];

        for action in actions {
            let serialized = serde_json::to_value(&action).expect("action should serialize");
            assert_eq!(
                serialized.get("type").and_then(Value::as_str),
                Some(action.kind()),
                "tag must equal kind() for {action:?}"
            );
            let round_tripped: GameAction =
                serde_json::from_value(serialized).expect("action should deserialize");
            assert_eq!(round_tripped, action);
        }
    }

    #[test]
    fn payload_value_reads_scalars_from_structured_payloads() {
        let payload = json!({
            "deck": "Izzet Phoenix",
            "cards_owned": 620,
            "ranked": true,
            "nested": { "ignored": 1 }
        });

        assert_eq!(payload_value(&payload, "deck").as_deref(), Some("Izzet Phoenix"));
        assert_eq!(payload_value(&payload, "cards_owned").as_deref(), Some("620"));
        assert_eq!(payload_value(&payload, "ranked").as_deref(), Some("true"));
        assert_eq!(payload_value(&payload, "nested"), None);
        assert_eq!(payload_value(&payload, "missing"), None);
    }

    #[test]
    fn flat_payload_builds_legacy_shaped_string_objects() {
        let mut pairs = BTreeMap::new();
        pairs.insert("match_id".to_owned(), "match-1".to_owned());
        pairs.insert("deck".to_owned(), "Esper Midrange".to_owned());

        let payload = flat_payload(pairs);
        assert_eq!(payload, json!({ "match_id": "match-1", "deck": "Esper Midrange" }));
        assert_eq!(payload_value(&payload, "deck").as_deref(), Some("Esper Midrange"));
    }
}
