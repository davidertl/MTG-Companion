use core_domain::{EventType, GameAction, NormalizedEvent};
use core_parser::{parse_log, parse_log_lossy};
use serde_json::Value;
use std::fs;

fn event_types(events: &[NormalizedEvent]) -> Vec<EventType> {
    events.iter().map(|event| event.event_type.clone()).collect()
}

fn pointer_str<'a>(event: &'a NormalizedEvent, pointer: &str) -> Option<&'a str> {
    event.payload.pointer(pointer).and_then(Value::as_str)
}

fn pointer_i64(event: &NormalizedEvent, pointer: &str) -> Option<i64> {
    event.payload.pointer(pointer).and_then(Value::as_i64)
}

fn action_of(event: &NormalizedEvent) -> GameAction {
    let action = event
        .payload
        .get("action")
        .expect("gameplay event should carry an action payload");
    serde_json::from_value(action.clone()).expect("action payload should deserialize as GameAction")
}

#[test]
fn single_cast_fixture_yields_cast_damage_and_life_events() {
    let log = fs::read_to_string("tests/fixtures/gre/synthetic__single_cast__shock_resolves.log")
        .expect("fixture should be readable");

    let report = parse_log("session-gre-cast", &log, 0).expect("fixture should parse without warnings");

    assert_eq!(
        event_types(&report.events),
        vec![
            EventType::GameStart,
            EventType::CardCast,
            EventType::PriorityPass,
            EventType::DamageDealt,
            EventType::ZoneTransfer,
            EventType::PriorityPass,
            EventType::LifeChanged,
        ]
    );
    // One raw chunk per JSON record (multi-line full state + two diffs).
    assert_eq!(report.raw_chunks.len(), 3);
    assert_eq!(report.next_offset, log.len() as u64);

    let game_start = &report.events[0];
    assert_eq!(game_start.timestamp, "638500000000000001");
    assert_eq!(pointer_str(game_start, "/matchId"), Some("synthetic-match-0001"));
    assert_eq!(pointer_str(game_start, "/onThePlay"), Some("1"));
    assert_eq!(pointer_str(game_start, "/action/type"), Some("gameStarted"));

    let cast = &report.events[1];
    assert_eq!(pointer_str(cast, "/action/type"), Some("castSpell"));
    assert_eq!(pointer_str(cast, "/action/actor"), Some("1"));
    assert_eq!(pointer_str(cast, "/action/fromZone"), Some("hand"));
    assert_eq!(pointer_i64(cast, "/action/cardRef/arenaId"), Some(68611));
    assert_eq!(pointer_i64(cast, "/instanceId"), Some(107));
    assert_eq!(pointer_i64(cast, "/grpId"), Some(68611));
    assert_eq!(pointer_str(cast, "/category"), Some("CastSpell"));
    match action_of(cast) {
        GameAction::CastSpell { actor, .. } => assert_eq!(actor, "1"),
        other => panic!("expected castSpell action, got {other:?}"),
    }

    let damage = &report.events[3];
    assert_eq!(pointer_str(damage, "/action/type"), Some("damageDealt"));
    assert_eq!(pointer_i64(damage, "/action/amount"), Some(2));
    assert_eq!(pointer_str(damage, "/action/targets/0/playerRef"), Some("2"));
    assert_eq!(pointer_i64(damage, "/sourceInstanceId"), Some(107));

    let resolve = &report.events[4];
    assert_eq!(pointer_str(resolve, "/action/type"), Some("zoneTransfer"));
    assert_eq!(pointer_str(resolve, "/action/fromZone"), Some("stack"));
    assert_eq!(pointer_str(resolve, "/action/toZone"), Some("graveyard"));
    assert_eq!(pointer_str(resolve, "/category"), Some("Resolve"));

    let life = &report.events[6];
    assert_eq!(pointer_str(life, "/action/type"), Some("lifeChanged"));
    assert_eq!(pointer_str(life, "/action/playerRef"), Some("2"));
    assert_eq!(pointer_i64(life, "/action/delta"), Some(-2));
    assert_eq!(pointer_i64(life, "/action/newTotal"), Some(18));
    assert_eq!(pointer_i64(life, "/lifeTotal"), Some(18));

    // Priority passes carry the passing seat as actor.
    assert_eq!(pointer_str(&report.events[2], "/action/actor"), Some("1"));
    assert_eq!(pointer_str(&report.events[5], "/action/actor"), Some("2"));
}

#[test]
fn combat_fixture_yields_declarations_damage_and_turn_flow() {
    let log =
        fs::read_to_string("tests/fixtures/gre/synthetic__combat__bears_trade_in_combat.log")
            .expect("fixture should be readable");

    let report = parse_log("session-gre-combat", &log, 0).expect("fixture should parse without warnings");

    assert_eq!(
        event_types(&report.events),
        vec![
            EventType::GameStart,
            EventType::PhaseChange,
            EventType::AttackersDeclared,
            EventType::PhaseChange,
            EventType::BlockersDeclared,
            EventType::Unknown("LogBusinessEvents".to_owned()),
            EventType::DamageDealt,
            EventType::DamageDealt,
            EventType::ZoneTransfer,
            EventType::ZoneTransfer,
            EventType::PhaseChange,
            EventType::TurnBegin,
            EventType::PhaseChange,
            EventType::PriorityPass,
        ]
    );

    let declare_attack_phase = &report.events[1];
    assert_eq!(pointer_str(declare_attack_phase, "/action/phase"), Some("Phase_Combat"));
    assert_eq!(pointer_str(declare_attack_phase, "/action/step"), Some("Step_DeclareAttack"));

    let attackers = &report.events[2];
    assert_eq!(pointer_str(attackers, "/action/type"), Some("declareAttackers"));
    assert_eq!(pointer_str(attackers, "/action/actor"), Some("1"));
    assert_eq!(pointer_str(attackers, "/action/attackers/0/objectRef"), Some("201"));
    assert_eq!(
        pointer_i64(attackers, "/action/attackers/0/cardRef/arenaId"),
        Some(70001)
    );
    assert_eq!(
        pointer_str(attackers, "/action/attackers/0/defendingTarget/playerRef"),
        Some("2")
    );
    assert_eq!(pointer_i64(attackers, "/attackers/0/instanceId"), Some(201));

    let blockers = &report.events[4];
    assert_eq!(pointer_str(blockers, "/action/type"), Some("declareBlockers"));
    assert_eq!(pointer_str(blockers, "/action/actor"), Some("2"));
    assert_eq!(pointer_str(blockers, "/action/blockers/0/objectRef"), Some("301"));
    assert_eq!(
        pointer_str(blockers, "/action/blockers/0/blockedAttacker/objectRef"),
        Some("201")
    );
    assert_eq!(
        pointer_i64(blockers, "/action/blockers/0/blockedAttacker/cardRef/arenaId"),
        Some(70001)
    );

    // Creature-to-creature damage targets objects, not players.
    let first_damage = &report.events[6];
    assert_eq!(pointer_str(first_damage, "/action/actor"), Some("1"));
    assert_eq!(pointer_str(first_damage, "/action/targets/0/objectRef"), Some("301"));
    assert_eq!(
        pointer_i64(first_damage, "/action/targets/0/cardRef/arenaId"),
        Some(70002)
    );
    let second_damage = &report.events[7];
    assert_eq!(pointer_str(second_damage, "/action/actor"), Some("2"));

    // Both dead bears move battlefield -> graveyard via SBA transfers.
    for dead in [&report.events[8], &report.events[9]] {
        assert_eq!(pointer_str(dead, "/action/fromZone"), Some("battlefield"));
        assert_eq!(pointer_str(dead, "/action/toZone"), Some("graveyard"));
        assert_eq!(pointer_str(dead, "/category"), Some("SBA_Damage"));
    }

    let turn_begin = &report.events[11];
    assert_eq!(pointer_i64(turn_begin, "/turnNumber"), Some(4));
    assert_eq!(pointer_str(turn_begin, "/action/actor"), Some("2"));
    match action_of(turn_begin) {
        GameAction::TurnBegan { turn_number, .. } => assert_eq!(turn_number, 4),
        other => panic!("expected turnBegan action, got {other:?}"),
    }
}

#[test]
fn full_game_fixture_covers_mulligans_plays_and_results() {
    let log = fs::read_to_string(
        "tests/fixtures/gre/synthetic__full_game__mulligan_to_concession.log",
    )
    .expect("fixture should be readable");

    let report = parse_log("session-gre-game", &log, 0).expect("fixture should parse without warnings");

    assert_eq!(
        event_types(&report.events),
        vec![
            EventType::MatchStart,
            EventType::Unknown("GREMessageType_ConnectResp".to_owned()),
            EventType::MulliganDecision,
            EventType::MulliganDecision,
            EventType::GameStart,
            EventType::LandPlayed,
            EventType::PhaseChange,
            EventType::CardCast,
            EventType::ZoneTransfer,
            EventType::AbilityActivated,
            EventType::TriggerFired,
            EventType::TurnBegin,
            EventType::PhaseChange,
            EventType::PriorityPass,
            EventType::GameEnd,
            EventType::MatchEnd,
        ]
    );
    // Every record (including the mulligan request without emitted events)
    // lands as one raw chunk: 13 JSON records in the fixture.
    assert_eq!(report.raw_chunks.len(), 13);

    let match_start = &report.events[0];
    assert_eq!(pointer_str(match_start, "/match_id"), Some("synthetic-match-0003"));
    assert_eq!(pointer_str(match_start, "/players/0/playerName"), Some("PlayerOne"));

    let first_mulligan = &report.events[2];
    assert_eq!(pointer_str(first_mulligan, "/action/decision"), Some("mulligan"));
    assert_eq!(pointer_i64(first_mulligan, "/action/handSize"), Some(7));
    assert_eq!(pointer_str(first_mulligan, "/action/actor"), Some("1"));
    let keep = &report.events[3];
    assert_eq!(pointer_str(keep, "/action/decision"), Some("keep"));
    assert_eq!(pointer_i64(keep, "/action/handSize"), Some(6));

    let game_start = &report.events[4];
    assert_eq!(pointer_i64(game_start, "/dieRolls/0/rollValue"), Some(6));
    assert_eq!(pointer_i64(game_start, "/dieRolls/1/systemSeatId"), Some(2));
    assert_eq!(pointer_str(game_start, "/onThePlay"), Some("1"));
    match action_of(game_start) {
        GameAction::GameStarted { players, on_the_play, .. } => {
            assert_eq!(players, vec!["1".to_owned(), "2".to_owned()]);
            assert_eq!(on_the_play.as_deref(), Some("1"));
        }
        other => panic!("expected gameStarted action, got {other:?}"),
    }

    let land = &report.events[5];
    assert_eq!(pointer_str(land, "/action/type"), Some("playLand"));
    assert_eq!(pointer_str(land, "/action/fromZone"), Some("hand"));
    assert_eq!(pointer_i64(land, "/grpId"), Some(90001));

    let ability = &report.events[9];
    assert_eq!(pointer_str(ability, "/action/type"), Some("activateAbility"));
    assert_eq!(pointer_i64(ability, "/action/cardRef/arenaId"), Some(90001));
    assert_eq!(pointer_i64(ability, "/instanceId"), Some(601));
    assert_eq!(pointer_i64(ability, "/parentId"), Some(501));

    let trigger = &report.events[10];
    assert_eq!(pointer_str(trigger, "/action/type"), Some("triggerNoted"));
    assert_eq!(pointer_i64(trigger, "/instanceId"), Some(701));

    let game_end = &report.events[14];
    assert_eq!(pointer_str(game_end, "/action/type"), Some("gameEnded"));
    assert_eq!(pointer_str(game_end, "/action/winnerRef"), Some("1"));
    assert_eq!(pointer_str(game_end, "/action/outcome"), Some("win"));
    assert_eq!(pointer_str(game_end, "/reason"), Some("ResultReason_Concede"));
    assert_eq!(pointer_str(game_end, "/matchId"), Some("synthetic-match-0003"));

    let match_end = &report.events[15];
    assert_eq!(pointer_str(match_end, "/match_id"), Some("synthetic-match-0003"));
    assert_eq!(pointer_str(match_end, "/result"), Some("1"));
}

#[test]
fn truncated_multiline_json_degrades_to_unknown_plus_diagnostic() {
    let log = "\
[UnityCrossThreadLogger]6/28/2026 6:00:00 PM: Match to Anon: GreToClientEvent
{
  \"transactionId\": \"synthetic-txn-trunc\",
  \"greToClientEvent\": {
    \"greToClientMessages\": [
";

    let result = parse_log_lossy("session-truncated", log, 0);

    assert_eq!(result.report.events.len(), 1);
    assert_eq!(
        result.report.events[0].event_type,
        EventType::Unknown("MTGA_MALFORMED_JSON".to_owned())
    );
    assert_eq!(
        pointer_str(&result.report.events[0], "/reason"),
        Some("truncated JSON record")
    );
    assert_eq!(result.warnings.len(), 1);
    assert!(result.warnings[0].message.contains("truncated"));
    assert_eq!(result.report.next_offset, log.len() as u64);
}

#[test]
fn malformed_balanced_json_degrades_to_unknown_plus_diagnostic() {
    let log = "\
[UnityCrossThreadLogger]Match to Anon: GreToClientEvent
{
  \"greToClientEvent\": oops
}
2026-05-06T21:00:00Z|MATCH_START|match_id=match-after|deck=Recovery
";

    let result = parse_log_lossy("session-malformed", log, 0);

    assert_eq!(result.report.events.len(), 2);
    assert_eq!(
        result.report.events[0].event_type,
        EventType::Unknown("MTGA_MALFORMED_JSON".to_owned())
    );
    assert!(result.warnings.len() == 1);
    assert!(result.warnings[0].message.contains("malformed JSON record"));

    // The parser recovers and keeps mapping subsequent lines.
    assert_eq!(result.report.events[1].event_type, EventType::MatchStart);
    assert_eq!(
        core_domain::payload_value(&result.report.events[1].payload, "deck").as_deref(),
        Some("Recovery")
    );
}

#[test]
fn truncated_record_interrupted_by_marker_line_recovers_on_next_record() {
    let log = "\
[UnityCrossThreadLogger]Match to Anon: GreToClientEvent
{
  \"greToClientEvent\": {
[UnityCrossThreadLogger]{\"timestamp\":\"2026-06-28T18:00:00Z\",\"eventName\":\"PlayerInventory.GetPlayerCardsV3\",\"payload\":{\"cardsOwned\":777}}
";

    let result = parse_log_lossy("session-interrupted", log, 0);

    assert_eq!(result.report.events.len(), 2);
    assert_eq!(
        result.report.events[0].event_type,
        EventType::Unknown("MTGA_MALFORMED_JSON".to_owned())
    );
    assert_eq!(result.report.events[1].event_type, EventType::CollectionSnapshot);
    assert_eq!(result.warnings.len(), 1);
}

#[test]
fn parse_never_panics_on_garbage_json_shapes() {
    // GRE-shaped records with wrong value types must degrade, not panic.
    let hostile = concat!(
        "[UnityCrossThreadLogger]{\"greToClientEvent\": 42}\n",
        "[UnityCrossThreadLogger]{\"greToClientEvent\": {\"greToClientMessages\": [{}]}}\n",
        "[UnityCrossThreadLogger]{\"greToClientEvent\": {\"greToClientMessages\": [{\"type\": \"GREMessageType_GameStateMessage\", \"gameStateMessage\": {\"type\": \"GameStateType_Diff\", \"annotations\": [{\"type\": [\"AnnotationType_ZoneTransfer\"], \"details\": \"not-an-array\"}], \"turnInfo\": \"nope\", \"players\": [{}], \"gameObjects\": [{\"instanceId\": \"strings-not-numbers\"}]}}]}}\n",
        "[UnityCrossThreadLogger]{\"matchGameRoomStateChangedEvent\": {\"gameRoomInfo\": {\"finalMatchResult\": {\"resultList\": [null, 17, {\"scope\": \"MatchScope_Match\"}]}}}}\n",
        "[UnityCrossThreadLogger]{\"clientToMatchServiceMessageType\": \"X\", \"payload\": {\"mulliganResp\": {}}}\n",
    );

    let result = parse_log_lossy("session-hostile", hostile, 0);

    // No panics, and the funnel still produces events for each record.
    assert!(result.report.events.len() >= 4);
}

/// Throughput sanity: parse a ~50MB synthetic detailed log. Run explicitly in
/// release mode:
/// `cargo test -p core-parser --release -- --ignored perf_parse_50mb_log`
#[test]
#[ignore]
fn perf_parse_50mb_log_under_ten_seconds() {
    let header = "[UnityCrossThreadLogger]6/28/2026 3:14:20 PM: Match to Anon: GreToClientEvent\n";
    let record = "{\"transactionId\":\"synthetic-txn-perf\",\"timestamp\":\"638500000000000002\",\"greToClientEvent\":{\"greToClientMessages\":[{\"type\":\"GREMessageType_GameStateMessage\",\"systemSeatIds\":[1],\"msgId\":3,\"gameStateId\":2,\"gameStateMessage\":{\"type\":\"GameStateType_Diff\",\"gameStateId\":2,\"gameObjects\":[{\"instanceId\":107,\"grpId\":68611,\"type\":\"GameObjectType_Card\",\"zoneId\":27,\"ownerSeatId\":1,\"controllerSeatId\":1,\"cardTypes\":[\"CardType_Instant\"]}],\"annotations\":[{\"id\":401,\"affectorId\":1,\"affectedIds\":[107],\"type\":[\"AnnotationType_ZoneTransfer\"],\"details\":[{\"key\":\"zone_src\",\"type\":\"KeyValuePairValueType_int32\",\"valueInt32\":[31]},{\"key\":\"zone_dest\",\"type\":\"KeyValuePairValueType_int32\",\"valueInt32\":[27]},{\"key\":\"category\",\"type\":\"KeyValuePairValueType_string\",\"valueString\":[\"CastSpell\"]}]}],\"turnInfo\":{\"phase\":\"Phase_Main1\",\"turnNumber\":1,\"activePlayer\":1,\"priorityPlayer\":2}}}]}}\n";

    let target_bytes = 50 * 1024 * 1024;
    let pair_len = header.len() + record.len();
    let repetitions = target_bytes / pair_len + 1;
    let mut log = String::with_capacity(repetitions * pair_len);
    for _ in 0..repetitions {
        log.push_str(header);
        log.push_str(record);
    }
    assert!(log.len() >= target_bytes);

    let started = std::time::Instant::now();
    let result = parse_log_lossy("session-perf", &log, 0);
    let elapsed = started.elapsed();

    assert!(result.warnings.is_empty());
    assert!(result.report.events.len() >= repetitions);
    assert!(
        elapsed.as_secs_f64() < 10.0,
        "50MB parse took {elapsed:?}, expected < 10s (release mode)"
    );
}
