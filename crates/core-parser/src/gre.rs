//! Play-level extraction from MTGA detailed-log GRE messages.
//!
//! Consumes `GreToClientEvent.greToClientMessages[]`,
//! `matchGameRoomStateChangedEvent`, and client `mulliganResp` records and
//! maps them onto the `core-domain` gameplay `EventType` variants. The parser
//! emits *observed transitions* only — zone-transfer annotations are
//! authoritative for object moves, and no full game-state tracking is
//! attempted here (that is the reconstruction layer's job).
//!
//! Payload convention (see `core-domain` module docs): every gameplay event
//! carries a serialized [`GameAction`] under the `"action"` key next to raw
//! Arena identifiers (`grpId`, `instanceId`, seat ids, zone ids, ...) so card
//! names can be resolved later via the card database.
//!
//! Known limitations (documented, deliberate):
//! - The context is per-parse-call: incremental live-watch slices that split a
//!   game across calls lose life/turn baselines; the first observation of a
//!   value only seeds the baseline and does not emit a transition event.
//! - `GameStateType_Full` snapshots seed baselines silently and emit only
//!   `GameStart` — mid-game reconnect snapshots do not re-emit transitions.

use core_domain::{
    ActionTarget, AttackerDeclaration, BlockerDeclaration, CardRef, Combatant, EventType,
    GameAction, GameOutcome, MulliganChoice, Zone,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

/// A parsed gameplay event before session/sequence assignment.
pub(crate) struct EventDraft {
    pub event_type: EventType,
    pub timestamp: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Default)]
struct InstanceInfo {
    grp_id: Option<u64>,
    controller: Option<u64>,
}

/// Cross-record extraction context for one `parse_log_lossy` call.
#[derive(Default)]
pub(crate) struct GreContext {
    zone_types: BTreeMap<u64, String>,
    instances: BTreeMap<u64, InstanceInfo>,
    known_seats: BTreeSet<u64>,
    team_seats: BTreeMap<u64, u64>,
    life: BTreeMap<u64, i64>,
    turn: Option<u64>,
    phase: Option<String>,
    step: Option<String>,
    priority: Option<u64>,
    active_player: Option<u64>,
    started_games: BTreeSet<u64>,
    consumed_game_results: usize,
    emitted_match_end: bool,
    reported_attackers: BTreeSet<u64>,
    reported_blockers: BTreeSet<u64>,
    reported_stack_objects: BTreeSet<u64>,
    pending_mulligan: Option<(Option<u64>, u64)>,
    die_rolls: Vec<(u64, i64)>,
    match_id: Option<String>,
    game_number: Option<u64>,
}

impl GreContext {
    fn zone_kind(&self, zone_id: u64) -> Zone {
        self.zone_types
            .get(&zone_id)
            .map(|zone_type| zone_from_type(zone_type))
            .unwrap_or(Zone::Unknown)
    }

    fn is_seat(&self, id: u64) -> bool {
        self.known_seats.contains(&id) || (id > 0 && id <= 4 && !self.instances.contains_key(&id))
    }

    fn winner_ref(&self, winning_team: Option<u64>) -> Option<String> {
        let team = winning_team?;
        Some(
            self.team_seats
                .get(&team)
                .map(|seat| seat.to_string())
                .unwrap_or_else(|| team.to_string()),
        )
    }
}

/// Entry point: recognizes GRE-family records. Returns `None` when the JSON
/// record is not a GRE/match-room/mulligan-response record, so the caller can
/// try the legacy `eventName` mapping.
pub(crate) fn extract_record(
    value: &Value,
    ctx: &mut GreContext,
    fallback_timestamp: &str,
) -> Option<Vec<EventDraft>> {
    let object = value.as_object()?;
    let timestamp = scalar_string(object.get("timestamp"))
        .unwrap_or_else(|| fallback_timestamp.to_owned());

    if let Some(gre) = object.get("greToClientEvent") {
        return Some(extract_gre_event(gre, &timestamp, ctx));
    }
    if let Some(room) = object.get("matchGameRoomStateChangedEvent") {
        return Some(extract_room_event(room, &timestamp, ctx));
    }
    if let Some(resp) = find_mulligan_resp(value) {
        return Some(extract_mulligan_decision(resp, &timestamp, ctx));
    }

    None
}

fn find_mulligan_resp(value: &Value) -> Option<&Value> {
    if let Some(resp) = value.get("mulliganResp").filter(|v| v.is_object()) {
        return Some(resp);
    }
    value
        .get("payload")
        .and_then(|payload| payload.get("mulliganResp"))
        .filter(|v| v.is_object())
}

fn extract_gre_event(gre: &Value, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let mut drafts = Vec::new();
    let Some(messages) = get_arr(gre, "greToClientMessages") else {
        return drafts;
    };

    for message in messages {
        let message_type = get_str(message, "type").unwrap_or("");
        match message_type {
            "GREMessageType_GameStateMessage" | "GREMessageType_QueuedGameStateMessage" => {
                drafts.extend(process_game_state(message, timestamp, ctx));
            }
            "GREMessageType_MulliganReq" => {
                let seat = message
                    .get("systemSeatIds")
                    .and_then(Value::as_array)
                    .and_then(|seats| seats.first())
                    .and_then(Value::as_u64);
                let count = message
                    .get("mulliganReq")
                    .and_then(|req| get_u64(req, "mulliganCount"))
                    .unwrap_or(0);
                ctx.pending_mulligan = Some((seat, count));
            }
            "GREMessageType_DieRollResultsResp" => {
                if let Some(rolls) = message
                    .get("dieRollResultsResp")
                    .and_then(|resp| get_arr(resp, "playerDieRolls"))
                {
                    for roll in rolls {
                        if let Some(seat) = get_u64(roll, "systemSeatId") {
                            let value = get_i64(roll, "rollValue").unwrap_or(0);
                            ctx.die_rolls.push((seat, value));
                        }
                    }
                }
            }
            other => {
                drafts.push(unknown_message_draft(message, other, timestamp));
            }
        }
    }

    drafts
}

fn unknown_message_draft(message: &Value, message_type: &str, timestamp: &str) -> EventDraft {
    let label = if message_type.is_empty() {
        "GREMessageType_Unknown"
    } else {
        message_type
    };
    let mut payload = Map::new();
    payload.insert("messageType".to_owned(), Value::String(label.to_owned()));
    if let Some(msg_id) = get_u64(message, "msgId") {
        payload.insert("msgId".to_owned(), Value::from(msg_id));
    }
    EventDraft {
        event_type: EventType::Unknown(label.to_owned()),
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

struct AttackerSighting {
    instance_id: u64,
    info: InstanceInfo,
    target_id: Option<u64>,
}

struct BlockerSighting {
    instance_id: u64,
    info: InstanceInfo,
    attacker_ids: Vec<u64>,
}

fn process_game_state(message: &Value, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let Some(gsm) = message.get("gameStateMessage").filter(|v| v.is_object()) else {
        return vec![unknown_message_draft(
            message,
            get_str(message, "type").unwrap_or("GREMessageType_GameStateMessage"),
            timestamp,
        )];
    };

    let is_full = get_str(gsm, "type") == Some("GameStateType_Full");
    let mut drafts = Vec::new();

    // 1. Zones: id -> type index.
    if let Some(zones) = get_arr(gsm, "zones") {
        for zone in zones {
            if let (Some(zone_id), Some(zone_type)) = (get_u64(zone, "zoneId"), get_str(zone, "type")) {
                ctx.zone_types.insert(zone_id, zone_type.to_owned());
            }
        }
    }

    // 2. Game info basics.
    let game_info = gsm.get("gameInfo");
    if let Some(info) = game_info {
        if let Some(match_id) = get_str(info, "matchID").or_else(|| get_str(info, "matchId")) {
            ctx.match_id = Some(match_id.to_owned());
        }
        if let Some(game_number) = get_u64(info, "gameNumber") {
            ctx.game_number = Some(game_number);
        }
    }

    // 3. Game objects: instance index, stack objects, combat sightings.
    let mut stack_object_drafts = Vec::new();
    let mut new_attackers: Vec<AttackerSighting> = Vec::new();
    let mut new_blockers: Vec<BlockerSighting> = Vec::new();
    if let Some(objects) = get_arr(gsm, "gameObjects") {
        for object in objects {
            let Some(instance_id) = get_u64(object, "instanceId") else {
                continue;
            };
            let info = InstanceInfo {
                grp_id: get_u64(object, "grpId"),
                controller: get_u64(object, "controllerSeatId")
                    .or_else(|| get_u64(object, "ownerSeatId")),
            };
            ctx.instances.insert(instance_id, info.clone());

            let object_type = get_str(object, "type").unwrap_or("");
            if matches!(
                object_type,
                "GameObjectType_Ability" | "GameObjectType_TriggerHolder"
            ) && ctx.reported_stack_objects.insert(instance_id)
                && !is_full
            {
                stack_object_drafts.push(stack_object_draft(object, instance_id, &info, object_type, timestamp));
            }

            if get_str(object, "attackState") == Some("AttackState_Attacking")
                && !ctx.reported_attackers.contains(&instance_id)
            {
                let target_id = object
                    .get("attackInfo")
                    .and_then(|attack| get_u64(attack, "targetId"));
                new_attackers.push(AttackerSighting { instance_id, info: info.clone(), target_id });
            }
            if get_str(object, "blockState") == Some("BlockState_Blocking")
                && !ctx.reported_blockers.contains(&instance_id)
            {
                let attacker_ids = object
                    .get("blockInfo")
                    .and_then(|block| block.get("attackerIds"))
                    .and_then(Value::as_array)
                    .map(|ids| ids.iter().filter_map(Value::as_u64).collect())
                    .unwrap_or_default();
                new_blockers.push(BlockerSighting { instance_id, info, attacker_ids });
            }
        }
    }

    // 4. Full snapshots: seed baselines silently, emit GameStart once.
    if is_full {
        seed_baselines(gsm, ctx);
        for sighting in &new_attackers {
            ctx.reported_attackers.insert(sighting.instance_id);
        }
        for sighting in &new_blockers {
            ctx.reported_blockers.insert(sighting.instance_id);
        }
        let game_key = ctx.game_number.unwrap_or(0);
        if ctx.started_games.insert(game_key) {
            drafts.push(game_start_draft(gsm, timestamp, ctx));
        }
        drafts.extend(process_results(game_info, timestamp, ctx));
        return drafts;
    }

    drafts.extend(stack_object_drafts);

    // 5. Annotations: zone transfers, damage, id changes, phase/turn markers.
    let mut pending_life_deltas: BTreeMap<u64, i64> = BTreeMap::new();
    let mut staged_phase: Option<String> = None;
    let mut staged_step: Option<String> = None;
    if let Some(annotations) = get_arr(gsm, "annotations") {
        for annotation in annotations {
            let types = annotation_types(annotation);
            if types.iter().any(|t| t == "AnnotationType_ObjectIdChanged") {
                apply_object_id_change(annotation, ctx);
            }
            if types.iter().any(|t| t == "AnnotationType_ZoneTransfer") {
                drafts.push(zone_transfer_draft(annotation, timestamp, ctx));
            }
            if types.iter().any(|t| t == "AnnotationType_DamageDealt") {
                drafts.push(damage_draft(annotation, timestamp, ctx));
            }
            if types.iter().any(|t| t == "AnnotationType_ModifiedLife") {
                if let (Some(seat), Some(delta)) = (
                    first_affected_id(annotation),
                    detail_i64(annotation, "life"),
                ) {
                    pending_life_deltas.insert(seat, delta);
                }
            }
            if types.iter().any(|t| t == "AnnotationType_PhaseOrStepModified") {
                if let Some(phase) = detail_str(annotation, "phase") {
                    staged_phase = Some(phase);
                }
                if let Some(step) = detail_str(annotation, "step") {
                    staged_step = Some(step);
                }
            }
            // AnnotationType_NewTurnStarted is covered by the turnInfo diff
            // below; the annotation alone carries no turn number.
        }
    }

    // 6. Turn info transitions: turn begin, phase change, priority pass.
    let turn_info = gsm.get("turnInfo").filter(|v| v.is_object());
    if let Some(info) = turn_info {
        if let Some(active) = get_u64(info, "activePlayer") {
            ctx.active_player = Some(active);
        }
    }
    if let Some(turn) = turn_info.and_then(|info| get_u64(info, "turnNumber")) {
        if ctx.turn != Some(turn) {
            ctx.turn = Some(turn);
            ctx.reported_attackers.clear();
            ctx.reported_blockers.clear();
            drafts.push(turn_begin_draft(turn, ctx.active_player, timestamp));
        }
    }

    let info_phase = turn_info.and_then(|info| get_str(info, "phase")).map(str::to_owned);
    let info_step = turn_info.and_then(|info| get_str(info, "step")).map(str::to_owned);
    let has_phase_signal =
        staged_phase.is_some() || staged_step.is_some() || info_phase.is_some() || info_step.is_some();
    if has_phase_signal {
        let next_phase = info_phase
            .or(staged_phase)
            .or_else(|| ctx.phase.clone());
        let next_step = if turn_info.map(|info| info.get("phase").is_some()).unwrap_or(false) {
            info_step.or(staged_step)
        } else {
            staged_step.or(info_step)
        };
        if next_phase != ctx.phase || next_step != ctx.step {
            ctx.phase = next_phase.clone();
            ctx.step = next_step.clone();
            drafts.push(phase_change_draft(next_phase, next_step, ctx.active_player, timestamp));
        }
    }

    if let Some(priority) = turn_info.and_then(|info| get_u64(info, "priorityPlayer")) {
        if let Some(previous) = ctx.priority {
            if previous != priority {
                drafts.push(priority_pass_draft(previous, priority, timestamp));
            }
        }
        ctx.priority = Some(priority);
    }

    // 7. Player diffs: life totals.
    if let Some(players) = get_arr(gsm, "players") {
        for player in players {
            let Some(seat) = get_u64(player, "systemSeatNumber")
                .or_else(|| get_u64(player, "systemSeatId"))
            else {
                continue;
            };
            ctx.known_seats.insert(seat);
            if let Some(team) = get_u64(player, "teamId") {
                ctx.team_seats.entry(team).or_insert(seat);
            }
            if let Some(life) = get_i64(player, "lifeTotal") {
                if let Some(&previous) = ctx.life.get(&seat) {
                    if previous != life {
                        drafts.push(life_changed_draft(seat, life - previous, Some(life), timestamp));
                        pending_life_deltas.remove(&seat);
                    }
                }
                ctx.life.insert(seat, life);
            }
        }
    }
    for (seat, delta) in pending_life_deltas {
        let new_total = ctx.life.get(&seat).map(|previous| previous + delta);
        if let Some(total) = new_total {
            ctx.life.insert(seat, total);
        }
        drafts.push(life_changed_draft(seat, delta, new_total, timestamp));
    }

    // 8. Combat declarations observed via attack/block states.
    if !new_attackers.is_empty() {
        for sighting in &new_attackers {
            ctx.reported_attackers.insert(sighting.instance_id);
        }
        drafts.push(attackers_draft(&new_attackers, timestamp, ctx));
    }
    if !new_blockers.is_empty() {
        for sighting in &new_blockers {
            ctx.reported_blockers.insert(sighting.instance_id);
        }
        drafts.push(blockers_draft(&new_blockers, timestamp, ctx));
    }

    // 9. Game results carried in gameInfo.
    drafts.extend(process_results(game_info, timestamp, ctx));

    drafts
}

fn seed_baselines(gsm: &Value, ctx: &mut GreContext) {
    if let Some(players) = get_arr(gsm, "players") {
        for player in players {
            let Some(seat) = get_u64(player, "systemSeatNumber")
                .or_else(|| get_u64(player, "systemSeatId"))
            else {
                continue;
            };
            ctx.known_seats.insert(seat);
            if let Some(team) = get_u64(player, "teamId") {
                ctx.team_seats.entry(team).or_insert(seat);
            }
            if let Some(life) = get_i64(player, "lifeTotal") {
                ctx.life.insert(seat, life);
            }
        }
    }
    if let Some(info) = gsm.get("turnInfo").filter(|v| v.is_object()) {
        if let Some(turn) = get_u64(info, "turnNumber") {
            ctx.turn = Some(turn);
        }
        if let Some(phase) = get_str(info, "phase") {
            ctx.phase = Some(phase.to_owned());
        }
        ctx.step = get_str(info, "step").map(str::to_owned);
        if let Some(active) = get_u64(info, "activePlayer") {
            ctx.active_player = Some(active);
        }
        if let Some(priority) = get_u64(info, "priorityPlayer") {
            ctx.priority = Some(priority);
        }
    }
}

fn game_start_draft(gsm: &Value, timestamp: &str, ctx: &mut GreContext) -> EventDraft {
    let mut player_summaries = Vec::new();
    let mut seats = Vec::new();
    if let Some(players) = get_arr(gsm, "players") {
        for player in players {
            let Some(seat) = get_u64(player, "systemSeatNumber")
                .or_else(|| get_u64(player, "systemSeatId"))
            else {
                continue;
            };
            seats.push(seat.to_string());
            let mut summary = Map::new();
            summary.insert("systemSeatNumber".to_owned(), Value::from(seat));
            if let Some(life) = get_i64(player, "lifeTotal") {
                summary.insert("lifeTotal".to_owned(), Value::from(life));
            }
            if let Some(team) = get_u64(player, "teamId") {
                summary.insert("teamId".to_owned(), Value::from(team));
            }
            player_summaries.push(Value::Object(summary));
        }
    }

    let on_the_play = gsm
        .get("turnInfo")
        .and_then(|info| get_u64(info, "activePlayer"))
        .or_else(|| {
            ctx.die_rolls
                .iter()
                .max_by_key(|(_, roll)| *roll)
                .map(|(seat, _)| *seat)
        })
        .map(|seat| seat.to_string());

    let action = GameAction::GameStarted {
        actor: on_the_play
            .clone()
            .or_else(|| seats.first().cloned())
            .unwrap_or_else(|| "unknown".to_owned()),
        card_ref: None,
        players: seats,
        on_the_play: on_the_play.clone(),
    };

    let die_rolls: Vec<Value> = ctx
        .die_rolls
        .drain(..)
        .map(|(seat, roll)| json!({ "systemSeatId": seat, "rollValue": roll }))
        .collect();

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    if let Some(match_id) = &ctx.match_id {
        payload.insert("matchId".to_owned(), Value::String(match_id.clone()));
    }
    if let Some(game_number) = ctx.game_number {
        payload.insert("gameNumber".to_owned(), Value::from(game_number));
    }
    payload.insert("players".to_owned(), Value::Array(player_summaries));
    if let Some(on_the_play) = on_the_play {
        payload.insert("onThePlay".to_owned(), Value::String(on_the_play));
    }
    if !die_rolls.is_empty() {
        payload.insert("dieRolls".to_owned(), Value::Array(die_rolls));
    }

    EventDraft {
        event_type: EventType::GameStart,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn stack_object_draft(
    object: &Value,
    instance_id: u64,
    info: &InstanceInfo,
    object_type: &str,
    timestamp: &str,
) -> EventDraft {
    let actor = seat_string(info.controller);
    let source_grp = get_u64(object, "objectSourceGrpId");
    let card_ref = source_grp.or(info.grp_id).map(|grp| CardRef {
        arena_id: Some(grp),
        ..CardRef::default()
    });

    let (event_type, action) = if object_type == "GameObjectType_Ability" {
        (
            EventType::AbilityActivated,
            GameAction::ActivateAbility {
                actor,
                card_ref,
                ability_text: None,
                targets: Vec::new(),
            },
        )
    } else {
        (
            EventType::TriggerFired,
            GameAction::TriggerNoted {
                actor,
                card_ref,
                trigger_text: None,
                targets: Vec::new(),
            },
        )
    };

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("instanceId".to_owned(), Value::from(instance_id));
    if let Some(grp) = info.grp_id {
        payload.insert("grpId".to_owned(), Value::from(grp));
    }
    if let Some(source_grp) = source_grp {
        payload.insert("objectSourceGrpId".to_owned(), Value::from(source_grp));
    }
    if let Some(parent) = get_u64(object, "parentId") {
        payload.insert("parentId".to_owned(), Value::from(parent));
    }
    if let Some(controller) = info.controller {
        payload.insert("controllerSeatId".to_owned(), Value::from(controller));
    }

    EventDraft {
        event_type,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn apply_object_id_change(annotation: &Value, ctx: &mut GreContext) {
    let (Some(orig_id), Some(new_id)) = (
        detail_u64(annotation, "orig_id"),
        detail_u64(annotation, "new_id"),
    ) else {
        return;
    };
    if let Some(info) = ctx.instances.get(&orig_id).cloned() {
        ctx.instances.entry(new_id).or_insert(info);
    }
}

fn zone_transfer_draft(annotation: &Value, timestamp: &str, ctx: &GreContext) -> EventDraft {
    let instance_id = first_affected_id(annotation);
    let zone_src = detail_u64(annotation, "zone_src");
    let zone_dest = detail_u64(annotation, "zone_dest");
    let from_zone = zone_src.map(|id| ctx.zone_kind(id)).unwrap_or(Zone::Unknown);
    let to_zone = zone_dest.map(|id| ctx.zone_kind(id)).unwrap_or(Zone::Unknown);
    let category = detail_str(annotation, "category").unwrap_or_default();

    let info = instance_id
        .and_then(|id| ctx.instances.get(&id))
        .cloned()
        .unwrap_or_default();
    let affector = get_u64(annotation, "affectorId");
    let actor_seat = info
        .controller
        .or_else(|| affector.filter(|id| ctx.is_seat(*id)));
    let actor = seat_string(actor_seat);
    let card_ref = info.grp_id.map(|grp| CardRef {
        arena_id: Some(grp),
        ..CardRef::default()
    });

    let (event_type, action) = match category.as_str() {
        "CastSpell" => (
            EventType::CardCast,
            GameAction::CastSpell {
                actor,
                card_ref,
                from_zone: Some(from_zone),
                targets: Vec::new(),
                mana_spent: None,
            },
        ),
        "PlayLand" => (
            EventType::LandPlayed,
            GameAction::PlayLand {
                actor,
                card_ref,
                from_zone: Some(from_zone),
            },
        ),
        _ => (
            EventType::ZoneTransfer,
            GameAction::ZoneTransfer {
                actor,
                card_ref,
                from_zone,
                to_zone,
            },
        ),
    };

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    if let Some(instance_id) = instance_id {
        payload.insert("instanceId".to_owned(), Value::from(instance_id));
    }
    if let Some(grp) = info.grp_id {
        payload.insert("grpId".to_owned(), Value::from(grp));
    }
    if let Some(controller) = info.controller {
        payload.insert("controllerSeatId".to_owned(), Value::from(controller));
    }
    if let Some(zone_src) = zone_src {
        payload.insert("zoneSrcId".to_owned(), Value::from(zone_src));
    }
    if let Some(zone_dest) = zone_dest {
        payload.insert("zoneDestId".to_owned(), Value::from(zone_dest));
    }
    if !category.is_empty() {
        payload.insert("category".to_owned(), Value::String(category));
    }

    EventDraft {
        event_type,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn damage_draft(annotation: &Value, timestamp: &str, ctx: &GreContext) -> EventDraft {
    let source = get_u64(annotation, "affectorId");
    let amount = detail_i64(annotation, "damage")
        .or_else(|| detail_i64(annotation, "amount"))
        .unwrap_or(0)
        .max(0) as u32;
    let affected = affected_ids(annotation);

    let source_info = source
        .filter(|id| !ctx.is_seat(*id))
        .and_then(|id| ctx.instances.get(&id))
        .cloned()
        .unwrap_or_default();
    let actor_seat = source_info
        .controller
        .or_else(|| source.filter(|id| ctx.is_seat(*id)));
    let card_ref = source_info.grp_id.map(|grp| CardRef {
        arena_id: Some(grp),
        ..CardRef::default()
    });

    let targets: Vec<ActionTarget> = affected
        .iter()
        .map(|&id| {
            if ctx.is_seat(id) {
                ActionTarget {
                    player_ref: Some(id.to_string()),
                    ..ActionTarget::default()
                }
            } else {
                let target_card = ctx.instances.get(&id).and_then(|info| info.grp_id).map(|grp| {
                    CardRef {
                        arena_id: Some(grp),
                        ..CardRef::default()
                    }
                });
                ActionTarget {
                    object_ref: Some(id.to_string()),
                    card_ref: target_card,
                    ..ActionTarget::default()
                }
            }
        })
        .collect();

    let action = GameAction::DamageDealt {
        actor: seat_string(actor_seat),
        card_ref,
        amount,
        targets,
    };

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    if let Some(source) = source {
        payload.insert("sourceInstanceId".to_owned(), Value::from(source));
    }
    if let Some(grp) = source_info.grp_id {
        payload.insert("grpId".to_owned(), Value::from(grp));
    }
    payload.insert("damage".to_owned(), Value::from(amount));
    payload.insert(
        "affectedIds".to_owned(),
        Value::Array(affected.iter().map(|&id| Value::from(id)).collect()),
    );

    EventDraft {
        event_type: EventType::DamageDealt,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn life_changed_draft(
    seat: u64,
    delta: i64,
    new_total: Option<i64>,
    timestamp: &str,
) -> EventDraft {
    let action = GameAction::LifeChanged {
        actor: seat.to_string(),
        card_ref: None,
        player_ref: seat.to_string(),
        delta,
        new_total,
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("systemSeatId".to_owned(), Value::from(seat));
    payload.insert("delta".to_owned(), Value::from(delta));
    if let Some(total) = new_total {
        payload.insert("lifeTotal".to_owned(), Value::from(total));
    }
    EventDraft {
        event_type: EventType::LifeChanged,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn turn_begin_draft(turn: u64, active_player: Option<u64>, timestamp: &str) -> EventDraft {
    let action = GameAction::TurnBegan {
        actor: seat_string(active_player),
        card_ref: None,
        turn_number: turn.min(u64::from(u32::MAX)) as u32,
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("turnNumber".to_owned(), Value::from(turn));
    if let Some(active) = active_player {
        payload.insert("activePlayer".to_owned(), Value::from(active));
    }
    EventDraft {
        event_type: EventType::TurnBegin,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn phase_change_draft(
    phase: Option<String>,
    step: Option<String>,
    active_player: Option<u64>,
    timestamp: &str,
) -> EventDraft {
    let action = GameAction::PhaseChanged {
        actor: seat_string(active_player),
        card_ref: None,
        phase: phase.clone().unwrap_or_else(|| "unknown".to_owned()),
        step: step.clone(),
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    if let Some(phase) = phase {
        payload.insert("phase".to_owned(), Value::String(phase));
    }
    if let Some(step) = step {
        payload.insert("step".to_owned(), Value::String(step));
    }
    if let Some(active) = active_player {
        payload.insert("activePlayer".to_owned(), Value::from(active));
    }
    EventDraft {
        event_type: EventType::PhaseChange,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn priority_pass_draft(from_seat: u64, to_seat: u64, timestamp: &str) -> EventDraft {
    let action = GameAction::PriorityPassed {
        actor: from_seat.to_string(),
        card_ref: None,
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("fromSeat".to_owned(), Value::from(from_seat));
    payload.insert("toSeat".to_owned(), Value::from(to_seat));
    EventDraft {
        event_type: EventType::PriorityPass,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn attackers_draft(sightings: &[AttackerSighting], timestamp: &str, ctx: &GreContext) -> EventDraft {
    let actor_seat = sightings
        .iter()
        .find_map(|sighting| sighting.info.controller)
        .or(ctx.active_player);

    let attackers: Vec<AttackerDeclaration> = sightings
        .iter()
        .map(|sighting| AttackerDeclaration {
            object_ref: Some(sighting.instance_id.to_string()),
            card_ref: sighting.info.grp_id.map(|grp| CardRef {
                arena_id: Some(grp),
                ..CardRef::default()
            }),
            defending_target: sighting.target_id.map(|target| {
                if ctx.is_seat(target) {
                    ActionTarget {
                        player_ref: Some(target.to_string()),
                        ..ActionTarget::default()
                    }
                } else {
                    ActionTarget {
                        object_ref: Some(target.to_string()),
                        ..ActionTarget::default()
                    }
                }
            }),
        })
        .collect();

    let raw: Vec<Value> = sightings
        .iter()
        .map(|sighting| {
            let mut entry = Map::new();
            entry.insert("instanceId".to_owned(), Value::from(sighting.instance_id));
            if let Some(grp) = sighting.info.grp_id {
                entry.insert("grpId".to_owned(), Value::from(grp));
            }
            if let Some(target) = sighting.target_id {
                entry.insert("targetId".to_owned(), Value::from(target));
            }
            Value::Object(entry)
        })
        .collect();

    let action = GameAction::DeclareAttackers {
        actor: seat_string(actor_seat),
        card_ref: None,
        attackers,
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("attackers".to_owned(), Value::Array(raw));

    EventDraft {
        event_type: EventType::AttackersDeclared,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn blockers_draft(sightings: &[BlockerSighting], timestamp: &str, ctx: &GreContext) -> EventDraft {
    let actor_seat = sightings
        .iter()
        .find_map(|sighting| sighting.info.controller);

    let blockers: Vec<BlockerDeclaration> = sightings
        .iter()
        .map(|sighting| BlockerDeclaration {
            object_ref: Some(sighting.instance_id.to_string()),
            card_ref: sighting.info.grp_id.map(|grp| CardRef {
                arena_id: Some(grp),
                ..CardRef::default()
            }),
            blocked_attacker: sighting.attacker_ids.first().map(|attacker| Combatant {
                object_ref: Some(attacker.to_string()),
                card_ref: ctx
                    .instances
                    .get(attacker)
                    .and_then(|info| info.grp_id)
                    .map(|grp| CardRef {
                        arena_id: Some(grp),
                        ..CardRef::default()
                    }),
            }),
        })
        .collect();

    let raw: Vec<Value> = sightings
        .iter()
        .map(|sighting| {
            let mut entry = Map::new();
            entry.insert("instanceId".to_owned(), Value::from(sighting.instance_id));
            if let Some(grp) = sighting.info.grp_id {
                entry.insert("grpId".to_owned(), Value::from(grp));
            }
            entry.insert(
                "attackerIds".to_owned(),
                Value::Array(sighting.attacker_ids.iter().map(|&id| Value::from(id)).collect()),
            );
            Value::Object(entry)
        })
        .collect();

    let action = GameAction::DeclareBlockers {
        actor: seat_string(actor_seat),
        card_ref: None,
        blockers,
    };
    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("blockers".to_owned(), Value::Array(raw));

    EventDraft {
        event_type: EventType::BlockersDeclared,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn process_results(game_info: Option<&Value>, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let Some(info) = game_info else {
        return Vec::new();
    };
    let Some(results) = info.get("results") else {
        return Vec::new();
    };
    consume_result_entries(results, timestamp, ctx)
}

/// Result lists are cumulative across a match (one entry per completed game,
/// plus a match-scope entry at the end); only entries beyond the consumed
/// counter are new. `gameInfo.results` and `finalMatchResult.resultList`
/// mirror each other, so they share the counter.
fn consume_result_entries(container: &Value, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let entries = result_entries(container);
    let mut drafts = Vec::new();
    for entry in entries.iter().skip(ctx.consumed_game_results) {
        let scope = get_str(entry, "scope").unwrap_or("");
        if scope == "MatchScope_Game" {
            drafts.push(game_end_draft(entry, timestamp, ctx));
        } else if scope == "MatchScope_Match" && !ctx.emitted_match_end {
            ctx.emitted_match_end = true;
            drafts.push(match_end_draft(entry, timestamp, ctx));
        }
    }
    ctx.consumed_game_results = ctx.consumed_game_results.max(entries.len());
    drafts
}

fn result_entries(container: &Value) -> Vec<&Value> {
    if let Some(entries) = container.as_array() {
        return entries.iter().collect();
    }
    if let Some(entries) = container.get("resultList").and_then(Value::as_array) {
        return entries.iter().collect();
    }
    Vec::new()
}

fn game_end_draft(entry: &Value, timestamp: &str, ctx: &GreContext) -> EventDraft {
    let winning_team = get_u64(entry, "winningTeamId");
    let winner_ref = ctx.winner_ref(winning_team);
    let result_type = get_str(entry, "result").unwrap_or("");
    let reason = get_str(entry, "reason").map(str::to_owned);
    let outcome = if result_type.contains("Draw") {
        Some(GameOutcome::Draw)
    } else if winner_ref.is_some() {
        Some(GameOutcome::Win)
    } else {
        Some(GameOutcome::Unknown)
    };

    let action = GameAction::GameEnded {
        actor: winner_ref.clone().unwrap_or_else(|| "unknown".to_owned()),
        card_ref: None,
        winner_ref: winner_ref.clone(),
        outcome,
        reason: reason.clone(),
    };

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    if let Some(match_id) = &ctx.match_id {
        payload.insert("matchId".to_owned(), Value::String(match_id.clone()));
    }
    if let Some(game_number) = ctx.game_number {
        payload.insert("gameNumber".to_owned(), Value::from(game_number));
    }
    if let Some(team) = winning_team {
        payload.insert("winningTeamId".to_owned(), Value::from(team));
    }
    if !result_type.is_empty() {
        payload.insert("result".to_owned(), Value::String(result_type.to_owned()));
    }
    if let Some(reason) = reason {
        payload.insert("reason".to_owned(), Value::String(reason));
    }

    EventDraft {
        event_type: EventType::GameEnd,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn match_end_draft(entry: &Value, timestamp: &str, ctx: &GreContext) -> EventDraft {
    let winning_team = get_u64(entry, "winningTeamId");
    let winner_ref = ctx.winner_ref(winning_team);

    let mut payload = Map::new();
    if let Some(match_id) = &ctx.match_id {
        payload.insert("match_id".to_owned(), Value::String(match_id.clone()));
    }
    payload.insert(
        "result".to_owned(),
        Value::String(winner_ref.unwrap_or_else(|| "unknown".to_owned())),
    );
    if let Some(team) = winning_team {
        payload.insert("winningTeamId".to_owned(), Value::from(team));
    }
    payload.insert("scope".to_owned(), Value::String("match".to_owned()));

    EventDraft {
        event_type: EventType::MatchEnd,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }
}

fn extract_room_event(room: &Value, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let mut drafts = Vec::new();
    let info = room.get("gameRoomInfo").filter(|v| v.is_object()).unwrap_or(room);
    let config = info.get("gameRoomConfig");

    if let Some(match_id) = config.and_then(|c| get_str(c, "matchId")) {
        ctx.match_id = Some(match_id.to_owned());
    }

    let mut player_summaries = Vec::new();
    if let Some(players) = config.and_then(|c| get_arr(c, "reservedPlayers")) {
        for player in players {
            let seat = get_u64(player, "systemSeatId");
            if let Some(seat) = seat {
                ctx.known_seats.insert(seat);
                if let Some(team) = get_u64(player, "teamId") {
                    ctx.team_seats.entry(team).or_insert(seat);
                }
            }
            let mut summary = Map::new();
            if let Some(name) = get_str(player, "playerName") {
                summary.insert("playerName".to_owned(), Value::String(name.to_owned()));
            }
            if let Some(seat) = seat {
                summary.insert("systemSeatId".to_owned(), Value::from(seat));
            }
            if let Some(team) = get_u64(player, "teamId") {
                summary.insert("teamId".to_owned(), Value::from(team));
            }
            player_summaries.push(Value::Object(summary));
        }
    }

    let state_type = get_str(info, "stateType").unwrap_or("");
    if state_type.contains("Playing") {
        let mut payload = Map::new();
        if let Some(match_id) = &ctx.match_id {
            payload.insert("match_id".to_owned(), Value::String(match_id.clone()));
        }
        payload.insert("state".to_owned(), Value::String(state_type.to_owned()));
        if !player_summaries.is_empty() {
            payload.insert("players".to_owned(), Value::Array(player_summaries.clone()));
        }
        drafts.push(EventDraft {
            event_type: EventType::MatchStart,
            timestamp: timestamp.to_owned(),
            payload: Value::Object(payload),
        });
    }

    if let Some(final_result) = info.get("finalMatchResult") {
        drafts.extend(consume_result_entries(final_result, timestamp, ctx));
        if !ctx.emitted_match_end && state_type.contains("Completed") {
            ctx.emitted_match_end = true;
            drafts.push(match_end_draft(&Value::Null, timestamp, ctx));
        }
    } else if state_type.contains("Completed") && !ctx.emitted_match_end {
        ctx.emitted_match_end = true;
        drafts.push(match_end_draft(&Value::Null, timestamp, ctx));
    }

    drafts
}

fn extract_mulligan_decision(resp: &Value, timestamp: &str, ctx: &mut GreContext) -> Vec<EventDraft> {
    let decision_raw = get_str(resp, "decision").unwrap_or("");
    let decision = if decision_raw.contains("AcceptHand") {
        MulliganChoice::Keep
    } else {
        MulliganChoice::Mulligan
    };

    let (seat, count) = ctx.pending_mulligan.take().unwrap_or((None, 0));
    let hand_size = 7u64.saturating_sub(count).min(7) as u8;

    let action = GameAction::MulliganDecision {
        actor: seat_string(seat),
        card_ref: None,
        decision,
        hand_size: Some(hand_size),
    };

    let mut payload = Map::new();
    payload.insert("action".to_owned(), action_value(&action));
    payload.insert("decision".to_owned(), Value::String(decision_raw.to_owned()));
    payload.insert("mulliganCount".to_owned(), Value::from(count));
    if let Some(seat) = seat {
        payload.insert("systemSeatId".to_owned(), Value::from(seat));
    }

    vec![EventDraft {
        event_type: EventType::MulliganDecision,
        timestamp: timestamp.to_owned(),
        payload: Value::Object(payload),
    }]
}

// --- JSON access helpers -------------------------------------------------

fn get_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn get_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn get_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn get_arr<'a>(value: &'a Value, key: &str) -> Option<&'a Vec<Value>> {
    value.get(key).and_then(Value::as_array)
}

fn scalar_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn annotation_types(annotation: &Value) -> Vec<String> {
    match annotation.get("type") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Some(Value::String(single)) => vec![single.clone()],
        _ => Vec::new(),
    }
}

fn affected_ids(annotation: &Value) -> Vec<u64> {
    annotation
        .get("affectedIds")
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default()
}

fn first_affected_id(annotation: &Value) -> Option<u64> {
    affected_ids(annotation).first().copied()
}

fn detail_entry<'a>(annotation: &'a Value, key: &str) -> Option<&'a Value> {
    annotation
        .get("details")?
        .as_array()?
        .iter()
        .find(|detail| get_str(detail, "key") == Some(key))
}

fn detail_i64(annotation: &Value, key: &str) -> Option<i64> {
    let detail = detail_entry(annotation, key)?;
    for value_key in ["valueInt32", "valueInt64", "valueUint32", "valueUint64"] {
        if let Some(value) = detail.get(value_key) {
            if let Some(entries) = value.as_array() {
                if let Some(first) = entries.first().and_then(Value::as_i64) {
                    return Some(first);
                }
            } else if let Some(number) = value.as_i64() {
                return Some(number);
            }
        }
    }
    None
}

fn detail_u64(annotation: &Value, key: &str) -> Option<u64> {
    detail_i64(annotation, key).and_then(|value| u64::try_from(value).ok())
}

fn detail_str(annotation: &Value, key: &str) -> Option<String> {
    let detail = detail_entry(annotation, key)?;
    match detail.get("valueString") {
        Some(Value::Array(entries)) => entries.first().and_then(Value::as_str).map(str::to_owned),
        Some(Value::String(single)) => Some(single.clone()),
        _ => None,
    }
}

fn zone_from_type(zone_type: &str) -> Zone {
    match zone_type {
        "ZoneType_Library" => Zone::Library,
        "ZoneType_Hand" => Zone::Hand,
        "ZoneType_Battlefield" => Zone::Battlefield,
        "ZoneType_Graveyard" => Zone::Graveyard,
        "ZoneType_Exile" => Zone::Exile,
        "ZoneType_Stack" => Zone::Stack,
        "ZoneType_Command" => Zone::Command,
        "ZoneType_Sideboard" => Zone::Sideboard,
        _ => Zone::Unknown,
    }
}

fn seat_string(seat: Option<u64>) -> String {
    seat.map(|seat| seat.to_string())
        .unwrap_or_else(|| "unknown".to_owned())
}

/// Serializing a `GameAction` cannot fail for these shapes, but the parser
/// must never panic — degrade to `null` defensively.
fn action_value(action: &GameAction) -> Value {
    serde_json::to_value(action).unwrap_or(Value::Null)
}
