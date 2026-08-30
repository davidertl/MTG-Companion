//! Deterministic game-state reconstruction for MancuTG-Companion.
//!
//! [`GameTimeline::from_events`] folds a slice of [`NormalizedEvent`]s — from
//! *either* source, Arena log parsing or PaperC manual logging — into an
//! ordered sequence of per-turn snapshots. It is a **pure function**: no I/O,
//! no clock, no network. The same input always yields the same timeline.
//!
//! # Sourcing model
//!
//! Both streams carry a serialized [`GameAction`] under the payload `"action"`
//! key (see the `core-domain` module docs). Arena events additionally carry raw
//! identifiers next to it (`instanceId`, `controllerSeatId`, `grpId`); paper
//! events carry only the action (with card *names* inside its [`CardRef`]).
//! Reconstruction reads the parsed action first and falls back to the raw
//! identifiers when present, so an Arena battlefield object gets a stable
//! `instance_id` while a paper object is matched by card name — both unify on
//! [`CardRef`].
//!
//! # Honest hidden information
//!
//! Public/visible zones (battlefield, graveyard, exile) hold full
//! [`ObjectState`] rows. Hidden zones (hand, library) are tracked as **counts
//! only** — the reconstruction never fabricates cards it did not observe.
//! Cards observed without any identity (no name, no `arenaId`) are represented
//! as instance-only / unknown [`ObjectState`]s (their [`CardRef`] is empty).
//!
//! # Tolerating gaps
//!
//! Partial logs never panic and never fail. When a baseline is missing (no
//! game start, no turn markers) or an event's action cannot be deserialized,
//! the timeline is still returned with [`Completeness::Partial`] and a
//! human-readable reason, plus per-degradation [`GameTimeline::notes`].

use core_domain::{CardRef, GameAction, GameOutcome, MulliganChoice, NormalizedEvent, Zone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Whether the reconstruction believes it saw a whole game.
///
/// `Partial` carries a short, stable reason describing the first gap that
/// downgraded confidence (further gaps are appended to
/// [`GameTimeline::notes`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "reason", rename_all = "camelCase")]
pub enum Completeness {
    /// A game start baseline and at least one turn were observed and every
    /// gameplay event folded cleanly.
    Complete,
    /// Something was missing or unparseable; the timeline is best-effort.
    Partial(String),
}

impl Completeness {
    pub fn is_complete(&self) -> bool {
        matches!(self, Self::Complete)
    }
}

/// One reconstructed card/object in a public zone.
///
/// `card_ref` unifies Arena (`arena_id`) and paper (`name`) identity; an empty
/// `CardRef` (all fields `None`) denotes an unknown / instance-only object. All
/// derived fields (`tapped`, `counters`) are best-effort and default to the
/// neutral value when the source stream does not report them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObjectState {
    /// Arena instance id when known; `None` for paper-sourced objects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<u64>,
    /// Unified card identity (Arena `arenaId` / paper `name`); empty when the
    /// object was observed without identity.
    pub card_ref: CardRef,
    /// Controlling player identifier (seat id for Arena, name for paper).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<String>,
    /// Best-effort tap state (currently always `false`; the observed streams do
    /// not carry an authoritative tap signal).
    pub tapped: bool,
    /// Best-effort counters keyed by counter name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub counters: BTreeMap<String, i64>,
}

impl ObjectState {
    /// Convenience: an object observed with neither name nor arena id.
    pub fn is_unknown(&self) -> bool {
        self.card_ref == CardRef::default()
    }
}

/// Per-player zone view within a [`TurnSnapshot`]. Public zones are full object
/// lists; hidden zones are counts only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerZones {
    pub battlefield: Vec<ObjectState>,
    pub graveyard: Vec<ObjectState>,
    pub exile: Vec<ObjectState>,
    pub hand_count: u32,
    pub library_count: u32,
}

/// A gameplay action recorded within a turn, either a fully parsed
/// [`GameAction`] or a raw fallback for events whose `"action"` payload could
/// not be deserialized (never dropped silently).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum TimelineAction {
    /// A cleanly deserialized action.
    Parsed(GameAction),
    /// An event that carried an `"action"` payload we could not parse; kept
    /// verbatim so nothing is lost.
    Raw {
        event_type: String,
        sequence: u64,
        payload: Value,
        note: String,
    },
}

/// The reconstructed state as of the end of one turn, plus every gameplay
/// action folded during it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshot {
    /// Turn number as reported by `TurnBegan`; `0` denotes the pre-game / setup
    /// bucket for actions observed before the first turn marker.
    pub turn_number: u32,
    /// Active player for the turn (seat id / name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_player: Option<String>,
    /// Phase as of the end of the turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    /// Step as of the end of the turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    /// Per-player zone snapshot, keyed by player identifier.
    pub zones: BTreeMap<String, PlayerZones>,
    /// Per-player life totals, keyed by player identifier.
    pub life_totals: BTreeMap<String, i64>,
    /// Actions folded during this turn, in observed order.
    pub actions: Vec<TimelineAction>,
}

/// Ordered per-turn snapshots plus a completeness marker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTimeline {
    pub turns: Vec<TurnSnapshot>,
    pub completeness: Completeness,
    /// Human-readable, ordered notes about degradations encountered while
    /// folding (missing baselines, unparsed actions, zone gaps).
    pub notes: Vec<String>,
}

impl GameTimeline {
    /// Fold a slice of normalized events into a deterministic timeline.
    ///
    /// Events are processed in ascending `sequence` order (stable for equal
    /// sequences), so callers may pass events in any order and get the same
    /// result. Non-gameplay events (those without an `"action"` payload) are
    /// ignored for state folding. This never panics.
    pub fn from_events(events: &[NormalizedEvent]) -> GameTimeline {
        let mut ordered: Vec<&NormalizedEvent> = events.iter().collect();
        ordered.sort_by_key(|event| event.sequence);

        let mut builder = TimelineBuilder::default();
        for event in ordered {
            builder.fold(event);
        }
        builder.finish()
    }
}

// --- internal folding machinery ------------------------------------------

#[derive(Default)]
struct TimelineBuilder {
    world: WorldState,
    /// Completed turns.
    turns: Vec<TurnSnapshot>,
    /// The turn currently accumulating actions, if any.
    current: Option<CurrentTurn>,
    notes: Vec<String>,
    saw_game_start: bool,
    saw_turn: bool,
    saw_any_gameplay: bool,
    saw_unparsed_action: bool,
}

struct CurrentTurn {
    turn_number: u32,
    active_player: Option<String>,
    actions: Vec<TimelineAction>,
}

impl TimelineBuilder {
    fn fold(&mut self, event: &NormalizedEvent) {
        let Some(action_value) = event.payload.get("action") else {
            // Not a gameplay event (e.g. MATCH_START / COLLECTION_SNAPSHOT).
            return;
        };
        self.saw_any_gameplay = true;

        let action: GameAction = match serde_json::from_value(action_value.clone()) {
            Ok(action) => action,
            Err(error) => {
                self.saw_unparsed_action = true;
                let note = format!(
                    "event #{} ({}) carried an unparseable action: {error}",
                    event.sequence,
                    event.event_type.label()
                );
                self.notes.push(note.clone());
                self.record_action(TimelineAction::Raw {
                    event_type: event.event_type.label().to_owned(),
                    sequence: event.sequence,
                    payload: event.payload.clone(),
                    note,
                });
                return;
            }
        };

        self.apply(action, event);
    }

    /// Apply one parsed action to the running world + current turn.
    fn apply(&mut self, action: GameAction, event: &NormalizedEvent) {
        match &action {
            GameAction::GameStarted {
                players,
                on_the_play,
                ..
            } => {
                self.saw_game_start = true;
                for player in players {
                    self.world.ensure_player(player);
                }
                if let Some(active) = on_the_play {
                    self.world.ensure_player(active);
                    self.world.active_player = Some(active.clone());
                }
            }
            GameAction::TurnBegan {
                turn_number, actor, ..
            } => {
                self.saw_turn = true;
                self.world.ensure_player(actor);
                self.world.active_player = Some(actor.clone());
                self.begin_turn(*turn_number, Some(actor.clone()));
            }
            GameAction::PhaseChanged { phase, step, .. } => {
                self.world.phase = Some(phase.clone());
                self.world.step = step.clone();
            }
            GameAction::LifeChanged {
                player_ref,
                delta,
                new_total,
                ..
            } => {
                self.world.ensure_player(player_ref);
                let resolved = new_total.unwrap_or_else(|| {
                    self.world
                        .life
                        .get(player_ref)
                        .copied()
                        .unwrap_or(STARTING_LIFE)
                        + delta
                });
                self.world.life.insert(player_ref.clone(), resolved);
            }
            GameAction::PlayLand {
                actor,
                card_ref,
                from_zone,
            } => {
                let instance_id = payload_u64(&event.payload, "instanceId");
                self.world.move_object(
                    actor,
                    instance_id,
                    card_ref.clone(),
                    from_zone.unwrap_or(Zone::Hand),
                    Zone::Battlefield,
                    &mut self.notes,
                );
            }
            GameAction::CastSpell {
                actor,
                from_zone,
                ..
            } => {
                // The spell leaves its origin zone for the stack; we track the
                // origin (hand count) but not the untracked stack. Its arrival
                // on the battlefield/graveyard is a later ZoneTransfer.
                if let Some(from) = from_zone {
                    self.world.leave_zone(actor, *from);
                }
            }
            GameAction::ZoneTransfer {
                actor,
                card_ref,
                from_zone,
                to_zone,
            } => {
                let instance_id = payload_u64(&event.payload, "instanceId");
                let controller = payload_u64(&event.payload, "controllerSeatId")
                    .map(|seat| seat.to_string())
                    .unwrap_or_else(|| actor.clone());
                self.world.move_object(
                    &controller,
                    instance_id,
                    card_ref.clone(),
                    *from_zone,
                    *to_zone,
                    &mut self.notes,
                );
            }
            GameAction::MulliganDecision {
                actor,
                decision,
                hand_size,
                ..
            } => {
                if matches!(decision, MulliganChoice::Keep) {
                    if let Some(size) = hand_size {
                        self.world.ensure_player(actor).hand_count = u32::from(*size);
                    }
                }
            }
            GameAction::GameEnded { .. } => {
                // Terminal; recorded as an action, no zone effect.
            }
            _ => {
                // ActivateAbility, TriggerNoted, DeclareAttackers,
                // DeclareBlockers, DamageDealt, PriorityPassed, ManualNote,
                // UndoApplied: recorded as actions, no direct zone/life fold
                // here (life is authoritative via LifeChanged).
            }
        }

        self.record_action(TimelineAction::Parsed(action));
    }

    /// Push an action into the current turn, opening a pre-game bucket if none
    /// has started yet.
    fn record_action(&mut self, action: TimelineAction) {
        if self.current.is_none() {
            self.begin_turn(0, self.world.active_player.clone());
        }
        if let Some(turn) = self.current.as_mut() {
            turn.actions.push(action);
        }
    }

    /// Close the current turn (snapshotting world state) and start a new one.
    fn begin_turn(&mut self, turn_number: u32, active_player: Option<String>) {
        self.flush_current();
        self.current = Some(CurrentTurn {
            turn_number,
            active_player,
            actions: Vec::new(),
        });
    }

    fn flush_current(&mut self) {
        if let Some(turn) = self.current.take() {
            self.turns.push(TurnSnapshot {
                turn_number: turn.turn_number,
                active_player: turn.active_player,
                phase: self.world.phase.clone(),
                step: self.world.step.clone(),
                zones: self.world.snapshot_zones(),
                life_totals: self.world.life.clone(),
                actions: turn.actions,
            });
        }
    }

    fn finish(mut self) -> GameTimeline {
        self.flush_current();

        let completeness = if !self.saw_any_gameplay {
            Completeness::Partial("no gameplay events observed".to_owned())
        } else if self.saw_unparsed_action {
            Completeness::Partial("one or more actions could not be deserialized".to_owned())
        } else if !self.saw_game_start {
            Completeness::Partial("no game start baseline observed".to_owned())
        } else if !self.saw_turn {
            Completeness::Partial("no turn markers observed".to_owned())
        } else {
            Completeness::Complete
        };

        GameTimeline {
            turns: self.turns,
            completeness,
            notes: self.notes,
        }
    }
}

const STARTING_LIFE: i64 = 20;

/// Mutable running state threaded through the fold.
#[derive(Default)]
struct WorldState {
    life: BTreeMap<String, i64>,
    zones: BTreeMap<String, PlayerZones>,
    active_player: Option<String>,
    phase: Option<String>,
    step: Option<String>,
}

impl WorldState {
    fn ensure_player(&mut self, player: &str) -> &mut PlayerZones {
        self.life.entry(player.to_owned()).or_insert(STARTING_LIFE);
        self.zones.entry(player.to_owned()).or_default()
    }

    /// Snapshot the current zones as an owned, sorted map.
    fn snapshot_zones(&self) -> BTreeMap<String, PlayerZones> {
        self.zones.clone()
    }

    /// Decrement a hidden-zone count (leaving hand/library) with a floor of 0.
    /// No effect for public zones.
    fn leave_zone(&mut self, player: &str, zone: Zone) {
        let zones = self.ensure_player(player);
        match zone {
            Zone::Hand => zones.hand_count = zones.hand_count.saturating_sub(1),
            Zone::Library => zones.library_count = zones.library_count.saturating_sub(1),
            _ => {}
        }
    }

    /// Move one object between zones, unifying Arena instance ids and paper
    /// names. Public source zones are searched by instance id then by card
    /// name; hidden source zones just decrement their count.
    fn move_object(
        &mut self,
        player: &str,
        instance_id: Option<u64>,
        card_ref: Option<CardRef>,
        from: Zone,
        to: Zone,
        notes: &mut Vec<String>,
    ) {
        self.ensure_player(player);
        let removed = self.remove_from_zone(player, instance_id, card_ref.as_ref(), from);

        let mut object = removed.unwrap_or(ObjectState {
            instance_id,
            card_ref: card_ref.clone().unwrap_or_default(),
            controller: Some(player.to_owned()),
            tapped: false,
            counters: BTreeMap::new(),
        });
        object.controller = Some(player.to_owned());
        if object.instance_id.is_none() {
            object.instance_id = instance_id;
        }
        // Upgrade identity if the transfer revealed a better CardRef.
        if let Some(reference) = &card_ref {
            if object.card_ref == CardRef::default() {
                object.card_ref = reference.clone();
            }
        }

        self.add_to_zone(player, to, object, notes);
    }

    fn remove_from_zone(
        &mut self,
        player: &str,
        instance_id: Option<u64>,
        card_ref: Option<&CardRef>,
        from: Zone,
    ) -> Option<ObjectState> {
        let zones = self.ensure_player(player);
        match from {
            Zone::Battlefield => remove_matching(&mut zones.battlefield, instance_id, card_ref),
            Zone::Graveyard => remove_matching(&mut zones.graveyard, instance_id, card_ref),
            Zone::Exile => remove_matching(&mut zones.exile, instance_id, card_ref),
            Zone::Hand => {
                zones.hand_count = zones.hand_count.saturating_sub(1);
                None
            }
            Zone::Library => {
                zones.library_count = zones.library_count.saturating_sub(1);
                None
            }
            // Stack / Command / Sideboard / Unknown are untracked sources.
            _ => None,
        }
    }

    fn add_to_zone(
        &mut self,
        player: &str,
        to: Zone,
        object: ObjectState,
        notes: &mut Vec<String>,
    ) {
        let zones = self.ensure_player(player);
        match to {
            Zone::Battlefield => zones.battlefield.push(object),
            Zone::Graveyard => zones.graveyard.push(object),
            Zone::Exile => zones.exile.push(object),
            Zone::Hand => zones.hand_count += 1,
            Zone::Library => zones.library_count += 1,
            Zone::Stack | Zone::Command | Zone::Sideboard | Zone::Unknown => {
                notes.push(format!(
                    "object moved to untracked zone {to:?} for player {player}; dropped from zone view"
                ));
            }
        }
    }
}

/// Remove the first object in a public-zone list matching the given identity:
/// by instance id when present, else by unified `CardRef` identity.
fn remove_matching(
    list: &mut Vec<ObjectState>,
    instance_id: Option<u64>,
    card_ref: Option<&CardRef>,
) -> Option<ObjectState> {
    let position = list.iter().position(|object| {
        if let (Some(wanted), Some(have)) = (instance_id, object.instance_id) {
            return wanted == have;
        }
        if let Some(reference) = card_ref {
            if reference != &CardRef::default() {
                return card_ref_matches(&object.card_ref, reference);
            }
        }
        false
    });
    position.map(|index| list.remove(index))
}

/// Two card references identify the same card when any concrete identifier
/// agrees (arena id, oracle id, or name).
fn card_ref_matches(a: &CardRef, b: &CardRef) -> bool {
    if let (Some(x), Some(y)) = (a.arena_id, b.arena_id) {
        return x == y;
    }
    if let (Some(x), Some(y)) = (&a.scryfall_oracle_id, &b.scryfall_oracle_id) {
        return x == y;
    }
    match (&a.name, &b.name) {
        (Some(x), Some(y)) => x.eq_ignore_ascii_case(y),
        _ => false,
    }
}

fn payload_u64(payload: &Value, key: &str) -> Option<u64> {
    payload.get(key).and_then(Value::as_u64)
}

/// Best-effort game outcome extracted from the last `GameEnded` action in a
/// timeline, if any. Convenience for read models; does not affect folding.
pub fn timeline_outcome(timeline: &GameTimeline) -> Option<(Option<String>, Option<GameOutcome>)> {
    for turn in timeline.turns.iter().rev() {
        for action in turn.actions.iter().rev() {
            if let TimelineAction::Parsed(GameAction::GameEnded {
                winner_ref,
                outcome,
                ..
            }) = action
            {
                return Some((winner_ref.clone(), *outcome));
            }
        }
    }
    None
}
