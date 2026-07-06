import { describe, expect, it } from "vitest";

import {
  buildGameEventBatch,
  createGameLogState,
  gameLogReducer,
  projectGameLog,
  type GameLogState,
  type PaperGameSetup,
} from "../src/state/gameLog";
import { castSpell, playLand } from "../src/state/actions";

const setup: PaperGameSetup = {
  sourceSessionId: "paper-session-1",
  captureSessionId: "capture-1",
  cameraId: "manual",
  platform: "paperc-web",
  startedAt: "2026-07-06T10:00:00.000Z",
  format: "modern",
  players: { player1: "Ann", player2: "Bob" },
  tournament: {
    tournamentId: "local",
    roundId: "local",
    tableId: "table-1",
    matchId: "match-1",
    gameKey: "mtg-paper",
  },
};

function seed(): GameLogState {
  let state = createGameLogState("player1");
  state = gameLogReducer(state, {
    type: "log",
    action: playLand("player1", "Island"),
    eventId: "evt-land",
    occurredAt: "2026-07-06T10:00:00.000Z",
  });
  state = gameLogReducer(state, {
    type: "log",
    action: castSpell("player1", "Brainstorm"),
    eventId: "evt-spell",
    occurredAt: "2026-07-06T10:01:00.000Z",
  });
  return state;
}

describe("PaperC undo-as-correction semantics", () => {
  it("hides the undone action in the projection but keeps it in the log", () => {
    let state = seed();
    state = gameLogReducer(state, {
      type: "undo",
      targetEventId: "evt-spell",
      eventId: "evt-undo",
      occurredAt: "2026-07-06T10:02:00.000Z",
    });

    // Append-only: the original entry is still present, plus the undo entry.
    expect(state.entries).toHaveLength(3);
    expect(state.entries.map((e) => e.eventId)).toContain("evt-spell");

    const projection = projectGameLog(state);
    expect(projection.undoneEventIds).toEqual(["evt-spell"]);
    // Visible excludes the undone action AND the undo entry itself.
    expect(projection.visible.map((e) => e.eventId)).toEqual(["evt-land"]);
    // Review still lists the undone action, flagged.
    const undoneRow = projection.review.find((r) => r.eventId === "evt-spell");
    expect(undoneRow?.undone).toBe(true);
  });

  it("emits an undoApplied correction event that supersedes the target", () => {
    let state = seed();
    state = gameLogReducer(state, {
      type: "undo",
      targetEventId: "evt-spell",
      eventId: "evt-undo",
      occurredAt: "2026-07-06T10:02:00.000Z",
      reason: "misplay",
    });

    const batch = buildGameEventBatch(state.entries, setup, "batch-undo");
    const undoEvent = batch.events.find((e) => e.eventId === "evt-undo");
    expect(undoEvent).toBeDefined();
    expect(undoEvent?.supersedesEventId).toBe("evt-spell");
    const payload = undoEvent?.payload as { action: { type: string; undoneEventId: string } };
    expect(payload.action.type).toBe("undoApplied");
    expect(payload.action.undoneEventId).toBe("evt-spell");
    // Nothing is deleted: all three entries emit events.
    expect(batch.events).toHaveLength(3);
  });

  it("is idempotent: a second undo of the same target is a no-op", () => {
    let state = seed();
    const undo = (id: string): void => {
      state = gameLogReducer(state, {
        type: "undo",
        targetEventId: "evt-spell",
        eventId: id,
        occurredAt: "2026-07-06T10:02:00.000Z",
      });
    };
    undo("evt-undo-1");
    undo("evt-undo-2");
    expect(state.entries).toHaveLength(3);
  });

  it("ignores undo of an unknown or already-undo entry", () => {
    let state = seed();
    const before = state.entries.length;
    state = gameLogReducer(state, {
      type: "undo",
      targetEventId: "does-not-exist",
      eventId: "evt-undo-x",
      occurredAt: "2026-07-06T10:02:00.000Z",
    });
    expect(state.entries).toHaveLength(before);
  });
});
