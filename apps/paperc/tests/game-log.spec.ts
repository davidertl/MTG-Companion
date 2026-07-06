import { describe, expect, it } from "vitest";

import {
  buildGameEventBatch,
  createGameLogState,
  gameLogReducer,
  observationKindForAction,
  projectGameLog,
  type GameLogCommand,
  type GameLogState,
  type PaperGameSetup,
} from "../src/state/gameLog";
import {
  castSpell,
  declareAttackers,
  gameStarted,
  lifeChanged,
  playLand,
  turnBegan,
} from "../src/state/actions";

const setup: PaperGameSetup = {
  sourceSessionId: "paper-session-1",
  captureSessionId: "capture-1",
  cameraId: "manual",
  platform: "paperc-web",
  clientVersion: "0.1.0",
  startedAt: "2026-07-06T10:00:00.000Z",
  format: "commander",
  players: { player1: "Ann", player2: "Bob" },
  tournament: {
    tournamentId: "local",
    roundId: "local",
    tableId: "table-1",
    matchId: "match-1",
    gameKey: "mtg-paper",
  },
};

function apply(state: GameLogState, commands: GameLogCommand[]): GameLogState {
  return commands.reduce(gameLogReducer, state);
}

function script(): GameLogState {
  let seq = 0;
  const next = (): { eventId: string; occurredAt: string } => {
    seq += 1;
    return {
      eventId: `evt-${seq}`,
      occurredAt: `2026-07-06T10:0${seq}:00.000Z`,
    };
  };
  const commands: GameLogCommand[] = [
    { type: "log", action: gameStarted(["player1", "player2"], "player1"), ...next() },
    { type: "log", action: turnBegan("player1", 1), ...next() },
    { type: "log", action: playLand("player1", "Forest"), ...next() },
    { type: "log", action: turnBegan("player2", 2), ...next() },
    { type: "log", action: castSpell("player2", "Lightning Bolt"), ...next() },
    { type: "log", action: lifeChanged("player1", -3), ...next() },
    { type: "log", action: turnBegan("player1", 3), ...next() },
    { type: "log", action: declareAttackers("player1", ["Grizzly Bears"]), ...next() },
  ];
  return apply(createGameLogState("player1"), commands);
}

describe("PaperC game log reducer", () => {
  it("tracks turn/phase/active player from the action stream", () => {
    const state = script();
    expect(state.turnNumber).toBe(3);
    expect(state.activePlayer).toBe("player1");
    expect(state.entries).toHaveLength(8);
    // turnBegan stamps the entry with the new turn number.
    const turn2 = state.entries.find(
      (e) => e.action.type === "turnBegan" && e.action.turnNumber === 2,
    );
    expect(turn2?.turnNumber).toBe(2);
  });

  it("maps every action to a paperc.observation.detected event via the builders", () => {
    const state = script();
    const batch = buildGameEventBatch(state.entries, setup, "batch-1");

    expect(batch.idempotencyKey).toBe("batch-1");
    expect(batch.sessions).toHaveLength(1);
    expect(batch.sessions[0].sourceKind).toBe("manual-entry");
    expect(batch.events).toHaveLength(8);

    for (const event of batch.events) {
      expect(event.eventType).toBe("paperc.observation.detected");
      expect(event.sourceApp).toBe("mancutg-paperc");
      expect(event.confidence).toBe(1);
      expect(event.provenance[0].sourceKind).toBe("manual-entry");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.action).toBeDefined();
      expect(payload.confidenceHint).toBe(1);
      expect(payload.tournamentId).toBe("local");
    }
  });

  it("classifies observation kinds by action type", () => {
    expect(observationKindForAction(playLand("player1", "Forest"))).toBe("card-move");
    expect(observationKindForAction(lifeChanged("player1", -3))).toBe("score-change");
    expect(observationKindForAction(gameStarted(["player1"]))).toBe("board-state");
  });

  it("preserves the typed action payload through the contract guard", () => {
    const state = apply(createGameLogState("player1"), [
      { type: "log", action: castSpell("player1", "Counterspell"), eventId: "e1", occurredAt: "2026-07-06T10:00:00.000Z" },
    ]);
    const batch = buildGameEventBatch(state.entries, setup, "batch-2");
    const payload = batch.events[0].payload as { action: { type: string; cardRef?: { name?: string } } };
    expect(payload.action.type).toBe("castSpell");
    expect(payload.action.cardRef?.name).toBe("Counterspell");
  });

  it("projects only active (non-undone) actions as visible", () => {
    const state = script();
    const projection = projectGameLog(state);
    expect(projection.visible).toHaveLength(8);
    expect(projection.undoneEventIds).toHaveLength(0);
  });
});
