/**
 * Append-only game log for the PaperC move logger (plan 2026-07-06-001 W2.2).
 *
 * Invariants (mirroring the ArenaC / core-store event model):
 *  - The log is append-only: entries are never removed or mutated in place.
 *  - "Undo" is a *correction*, not a delete: it appends an `undoApplied` action
 *    that references the target event id. The undone action stays in the log;
 *    projections hide it. The emitted correction event carries `supersedesEventId`.
 *  - Every entry maps to exactly one `paperc.observation.detected` event with a
 *    typed `gameActions` payload, `provenance: 'manual'`, `confidence: 1`. The
 *    shared-schema builders (src/events/builders.ts) are the contract guard.
 *
 * The reducer is pure: ids and timestamps are supplied by the caller so tests
 * are deterministic (golden JSON) and React can own id/clock generation.
 */

import type {
  BackendEventBatchEnvelope,
  FindingVisibilityMode,
  GameAction,
  TournamentContext,
} from "../../../../packages/shared-schema/src/index";
import { buildPapercEventBatch } from "../events/builders";

export type PapercObservationKind =
  | "board-state"
  | "card-move"
  | "score-change"
  | "result-hint"
  | "timer-state";

export type GameLogEntry = {
  eventId: string;
  seq: number;
  occurredAt: string;
  turnNumber: number;
  phase: string;
  actor: string;
  action: GameAction;
};

export type GameLogState = {
  entries: GameLogEntry[];
  seq: number;
  turnNumber: number;
  phase: string;
  activePlayer: string;
};

export type GameLogCommand =
  | { type: "log"; action: GameAction; eventId: string; occurredAt: string }
  | {
      type: "undo";
      targetEventId: string;
      eventId: string;
      occurredAt: string;
      reason?: string;
      actor?: string;
    }
  | { type: "hydrate"; state: GameLogState };

export const INITIAL_PHASE = "beginning";

export function createGameLogState(activePlayer: string): GameLogState {
  return {
    entries: [],
    seq: 0,
    turnNumber: 1,
    phase: INITIAL_PHASE,
    activePlayer,
  };
}

function appendEntry(
  state: GameLogState,
  action: GameAction,
  eventId: string,
  occurredAt: string,
): GameLogState {
  let turnNumber = state.turnNumber;
  let phase = state.phase;
  let activePlayer = state.activePlayer;

  if (action.type === "turnBegan") {
    turnNumber = action.turnNumber;
    phase = INITIAL_PHASE;
    activePlayer = action.actor;
  } else if (action.type === "phaseChanged") {
    phase = action.phase;
  }

  const entry: GameLogEntry = {
    eventId,
    seq: state.seq,
    occurredAt,
    turnNumber,
    phase,
    actor: action.actor,
    action,
  };

  return {
    entries: [...state.entries, entry],
    seq: state.seq + 1,
    turnNumber,
    phase,
    activePlayer,
  };
}

function isUndone(state: GameLogState, eventId: string): boolean {
  return state.entries.some(
    (entry) =>
      entry.action.type === "undoApplied" &&
      entry.action.undoneEventId === eventId,
  );
}

export function gameLogReducer(
  state: GameLogState,
  command: GameLogCommand,
): GameLogState {
  switch (command.type) {
    case "hydrate":
      return command.state;
    case "log":
      return appendEntry(state, command.action, command.eventId, command.occurredAt);
    case "undo": {
      const target = state.entries.find(
        (entry) => entry.eventId === command.targetEventId,
      );
      // No-op on unknown target, on undoing an undo, or on a double undo — keeps
      // the correction stream clean and idempotent.
      if (!target || target.action.type === "undoApplied") {
        return state;
      }
      if (isUndone(state, command.targetEventId)) {
        return state;
      }
      const undoAction: GameAction = {
        type: "undoApplied",
        actor: command.actor ?? state.activePlayer,
        undoneEventId: command.targetEventId,
        ...(command.reason ? { reason: command.reason } : {}),
      };
      return appendEntry(state, undoAction, command.eventId, command.occurredAt);
    }
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

export type ReviewRow = GameLogEntry & { undone: boolean };

export type GameLogProjection = {
  /** Event ids that a later `undoApplied` action has retracted. */
  undoneEventIds: string[];
  /** Active game actions (undo entries and undone actions removed). */
  visible: GameLogEntry[];
  /** All non-undo entries, each tagged with whether it was undone. */
  review: ReviewRow[];
};

export function projectGameLog(state: GameLogState): GameLogProjection {
  const undone = new Set<string>();
  for (const entry of state.entries) {
    if (entry.action.type === "undoApplied") {
      undone.add(entry.action.undoneEventId);
    }
  }
  const nonUndo = state.entries.filter(
    (entry) => entry.action.type !== "undoApplied",
  );
  return {
    undoneEventIds: [...undone],
    visible: nonUndo.filter((entry) => !undone.has(entry.eventId)),
    review: nonUndo.map((entry) => ({
      ...entry,
      undone: undone.has(entry.eventId),
    })),
  };
}

// --- Emission layer (maps entries -> shared-contract events) -----------------

export type PaperGameSetup = {
  sourceSessionId: string;
  captureSessionId: string;
  /** Synthetic camera id for manual entry — the contract requires one. */
  cameraId: string;
  platform: string;
  clientVersion?: string;
  startedAt: string;
  format: string;
  players: { player1: string; player2: string };
  tournament: TournamentContext;
  /**
   * Visibility mode of the bound tournament. When `referee-only`, the logging
   * UI suppresses all local findings (client-side second layer to the backend's
   * enforcement — see src/state/findingSuppression.ts). Undefined for casual
   * local games and treated as `players`.
   */
  findingVisibilityMode?: FindingVisibilityMode;
};

export function observationKindForAction(action: GameAction): PapercObservationKind {
  switch (action.type) {
    case "lifeChanged":
    case "damageDealt":
      return "score-change";
    case "gameEnded":
      return "result-hint";
    case "playLand":
    case "castSpell":
    case "activateAbility":
    case "zoneTransfer":
    case "declareAttackers":
    case "declareBlockers":
      return "card-move";
    default:
      // triggerNoted, manualNote, turnBegan, phaseChanged, priorityPassed,
      // mulliganDecision, gameStarted, undoApplied
      return "board-state";
  }
}

function sessionInput(setup: PaperGameSetup) {
  return {
    sourceSessionId: setup.sourceSessionId,
    sourceApp: "mancutg-paperc" as const,
    sourceKind: "manual-entry" as const,
    platform: setup.platform,
    gameMode: "paper" as const,
    startedAt: setup.startedAt,
    streamId: setup.tournament.tableId,
    clientVersion: setup.clientVersion,
    metadata: {
      capture: {
        ...setup.tournament,
        captureSessionId: setup.captureSessionId,
        cameraId: setup.cameraId,
      },
      notes: `format=${setup.format}; ${setup.players.player1} vs ${setup.players.player2}`,
    },
  };
}

function entryEnvelopeInput(entry: GameLogEntry, setup: PaperGameSetup) {
  const supersedesEventId =
    entry.action.type === "undoApplied" ? entry.action.undoneEventId : null;
  return {
    eventId: entry.eventId,
    sourceApp: "mancutg-paperc" as const,
    sourceSessionId: setup.sourceSessionId,
    eventType: "paperc.observation.detected" as const,
    occurredAt: entry.occurredAt,
    streamId: setup.tournament.tableId,
    matchId: setup.tournament.matchId,
    seq: entry.seq,
    provenance: [
      {
        sourceKind: "manual-entry" as const,
        sourceSessionId: setup.sourceSessionId,
      },
    ],
    confidence: 1,
    supersedesEventId,
    payload: {
      ...setup.tournament,
      captureSessionId: setup.captureSessionId,
      cameraId: setup.cameraId,
      observationKind: observationKindForAction(entry.action),
      action: entry.action,
      confidenceHint: 1,
      details: {},
    },
  };
}

/**
 * Builds a validated event batch from log entries. Runs through the existing
 * shared-schema builders so every payload is contract-checked (provenance,
 * tournament context, typed action). Append-only: undone actions and their
 * `undoApplied` corrections are both emitted; nothing is dropped.
 */
export function buildGameEventBatch(
  entries: GameLogEntry[],
  setup: PaperGameSetup,
  idempotencyKey?: string,
): BackendEventBatchEnvelope {
  return buildPapercEventBatch({
    idempotencyKey,
    sessions: [sessionInput(setup)],
    events: entries.map((entry) => entryEnvelopeInput(entry, setup)),
  });
}
