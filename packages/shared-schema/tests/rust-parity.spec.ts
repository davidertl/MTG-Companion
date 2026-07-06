import { describe, expect, it } from "vitest";

import { gameActionSchema } from "../src/gameActions.js";

/**
 * Cross-language parity guard (plan 2026-07-06-001, Wave 0 gate).
 *
 * These JSON samples are byte-for-byte the shapes the Rust `core-domain`
 * `GameAction` serializer emits (see the serde tests in
 * crates/core-domain/src/lib.rs). If either side changes shape, this spec
 * or the Rust round-trip tests must fail — keep both aligned.
 */
describe("rust GameAction JSON parity", () => {
  it("accepts the Rust castSpell serialization", () => {
    const parsed = gameActionSchema.parse({
      type: "castSpell",
      actor: "player-1",
      cardRef: { name: "Lightning Strike", arenaId: 91234 },
      fromZone: "hand",
      targets: [{ playerRef: "player-2" }],
      manaSpent: "{1}{R}",
    });
    expect(parsed.type).toBe("castSpell");
  });

  it("accepts the Rust zoneTransfer serialization", () => {
    const parsed = gameActionSchema.parse({
      type: "zoneTransfer",
      actor: "p1",
      cardRef: { name: "Grizzly Bears", scryfallOracleId: "oracle-1" },
      fromZone: "battlefield",
      toZone: "graveyard",
    });
    expect(parsed.type).toBe("zoneTransfer");
  });

  it("accepts the Rust declareBlockers serialization", () => {
    const parsed = gameActionSchema.parse({
      type: "declareBlockers",
      actor: "p2",
      blockers: [
        {
          cardRef: { name: "Grizzly Bears" },
          blockedAttacker: { objectRef: "obj-7" },
        },
      ],
    });
    expect(parsed.type).toBe("declareBlockers");
  });

  it("accepts the Rust mulliganDecision serialization", () => {
    const parsed = gameActionSchema.parse({
      type: "mulliganDecision",
      actor: "p1",
      decision: "mulligan",
      handSize: 6,
    });
    expect(parsed.type).toBe("mulliganDecision");
  });

  it("accepts the Rust lifeChanged serialization", () => {
    const parsed = gameActionSchema.parse({
      type: "lifeChanged",
      actor: "p2",
      playerRef: "p2",
      delta: -2,
      newTotal: 18,
    });
    expect(parsed.type).toBe("lifeChanged");
  });

  it("accepts the Rust gameEnded and undoApplied serializations", () => {
    expect(
      gameActionSchema.parse({
        type: "gameEnded",
        actor: "p1",
        winnerRef: "p1",
        outcome: "win",
        reason: "combat damage",
      }).type,
    ).toBe("gameEnded");
    expect(
      gameActionSchema.parse({
        type: "undoApplied",
        actor: "p2",
        undoneEventId: "evt-41",
        reason: "misclick",
      }).type,
    ).toBe("undoApplied");
  });
});
