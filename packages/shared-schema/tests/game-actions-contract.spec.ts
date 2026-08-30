import { describe, expect, it } from "vitest";

import {
  backendEventEnvelopeSchema,
  gameActionSchema,
  gameActionTypeSchema,
  papercObservationPayloadSchema,
  validatePapercEventContract,
} from "../src/index.ts";

function captureContext() {
  return {
    tournamentId: "tournament-1",
    roundId: "round-4",
    tableId: "table-12",
    matchId: "match-2",
    gameKey: "mtg-paper",
    captureSessionId: "capture-1",
    cameraId: "manual-entry",
  };
}

function observationEnvelope(payload: Record<string, unknown>) {
  return backendEventEnvelopeSchema.parse({
    eventId: "paper-observation-1",
    sourceApp: "mancutg-paperc",
    sourceSessionId: "paper-session-1",
    eventType: "paperc.observation.detected",
    occurredAt: "2026-07-06T10:00:00Z",
    provenance: [
      {
        sourceKind: "manual-entry",
        sourceSessionId: "paper-session-1",
      },
    ],
    payload,
  });
}

describe("gameActionSchema", () => {
  it("covers all seventeen shared action types", () => {
    expect(gameActionTypeSchema.options).toEqual([
      "playLand",
      "castSpell",
      "activateAbility",
      "triggerNoted",
      "declareAttackers",
      "declareBlockers",
      "damageDealt",
      "lifeChanged",
      "zoneTransfer",
      "mulliganDecision",
      "turnBegan",
      "phaseChanged",
      "priorityPassed",
      "gameStarted",
      "gameEnded",
      "manualNote",
      "undoApplied",
    ]);
    for (const type of gameActionTypeSchema.options) {
      expect(
        gameActionSchema.options.some(
          (option) => option.shape.type.value === type,
        ),
      ).toBe(true);
    }
  });

  it("parses a castSpell action with card ref and targets, applying defaults", () => {
    const action = gameActionSchema.parse({
      type: "castSpell",
      actor: "player-1",
      cardRef: {
        name: "Lightning Strike",
        arenaId: 91234,
        scryfallOracleId: "4d4a8fca-6035-4a26-8a38-eff30b40a7e7",
      },
      targets: [{ playerRef: "player-2" }],
    });

    if (action.type !== "castSpell") {
      throw new Error("expected castSpell action");
    }
    expect(action.fromZone).toBe("hand");
    expect(action.targets).toEqual([{ playerRef: "player-2" }]);
  });

  it("parses a zoneTransfer with explicit zones and rejects unknown zones", () => {
    const action = gameActionSchema.parse({
      type: "zoneTransfer",
      actor: "player-1",
      cardRef: { name: "Llanowar Elves" },
      fromZone: "battlefield",
      toZone: "graveyard",
    });

    expect(action).toMatchObject({
      fromZone: "battlefield",
      toZone: "graveyard",
    });
    expect(() =>
      gameActionSchema.parse({
        type: "zoneTransfer",
        actor: "player-1",
        fromZone: "battlefield",
        toZone: "the-bin",
      }),
    ).toThrow();
  });

  it("rejects unknown action types and missing actor", () => {
    expect(() =>
      gameActionSchema.parse({ type: "castSorcery", actor: "player-1" }),
    ).toThrow();
    expect(() => gameActionSchema.parse({ type: "playLand" })).toThrow();
  });

  it("works entirely without cardRef for actions that do not need one", () => {
    const action = gameActionSchema.parse({
      type: "lifeChanged",
      actor: "player-2",
      playerRef: "player-2",
      delta: -3,
      newTotal: 17,
    });

    expect(action).toMatchObject({ delta: -3, newTotal: 17 });
  });
});

describe("paperc observation with typed actions", () => {
  it("round-trips an observation carrying a typed castSpell action", () => {
    const validated = validatePapercEventContract(
      observationEnvelope({
        ...captureContext(),
        observationKind: "card-move",
        action: {
          type: "castSpell",
          actor: "player-1",
          cardRef: { name: "Lightning Strike" },
          targets: [{ playerRef: "player-2" }],
        },
      }),
    );

    const payload = validated.payload as {
      action?: { type: string; fromZone: string; actor: string };
      details: Record<string, unknown>;
    };
    expect(payload.action?.type).toBe("castSpell");
    expect(payload.action?.actor).toBe("player-1");
    expect(payload.action?.fromZone).toBe("hand");
    expect(payload.details).toEqual({});

    // Round-trip: the validated envelope still satisfies the contract.
    const revalidated = validatePapercEventContract(
      backendEventEnvelopeSchema.parse(validated),
    );
    expect(revalidated.payload).toEqual(validated.payload);
  });

  it("still validates legacy observations without an action (details escape hatch)", () => {
    const validated = validatePapercEventContract(
      observationEnvelope({
        ...captureContext(),
        observationKind: "card-move",
        candidateRef: "card-move-7",
        details: { rawLabel: "creature moved to graveyard" },
      }),
    );

    const payload = validated.payload as {
      action?: unknown;
      details: Record<string, unknown>;
    };
    expect(payload.action).toBeUndefined();
    expect(payload.details).toEqual({
      rawLabel: "creature moved to graveyard",
    });
  });

  it("rejects an observation whose action does not match the union", () => {
    expect(() =>
      validatePapercEventContract(
        observationEnvelope({
          ...captureContext(),
          observationKind: "card-move",
          action: { type: "castSpell" },
        }),
      ),
    ).toThrow();
  });

  it("accepts typed actions directly on the observation payload schema", () => {
    const payload = papercObservationPayloadSchema.parse({
      ...captureContext(),
      observationKind: "board-state",
      action: {
        type: "turnBegan",
        actor: "player-1",
        turnNumber: 3,
      },
    });

    expect(payload.action).toMatchObject({ type: "turnBegan", turnNumber: 3 });
  });
});
