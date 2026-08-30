import { z } from "zod";

/**
 * Shared typed game-action vocabulary for Arena- and Paper-sourced play
 * streams (plan 2026-07-06-001, unit W0.1).
 *
 * The Rust `core-domain` gameplay `EventType` variants (unit W0.2) mirror
 * this union field-for-field; keep both sides aligned when amending.
 */

export const gameActionCardRefSchema = z.object({
  name: z.string().min(1).optional(),
  arenaId: z.number().int().nonnegative().optional(),
  scryfallOracleId: z.string().min(1).optional(),
});

export const gameZoneSchema = z.enum([
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "stack",
  "command",
  "sideboard",
  "unknown",
]);

export const gameActionTargetSchema = z.object({
  playerRef: z.string().min(1).optional(),
  objectRef: z.string().min(1).optional(),
  cardRef: gameActionCardRefSchema.optional(),
  zoneRef: gameZoneSchema.optional(),
});

const gameActionBaseSchema = z.object({
  actor: z.string().min(1),
  cardRef: gameActionCardRefSchema.optional(),
});

export const playLandActionSchema = gameActionBaseSchema.extend({
  type: z.literal("playLand"),
  fromZone: gameZoneSchema.default("hand"),
});

export const castSpellActionSchema = gameActionBaseSchema.extend({
  type: z.literal("castSpell"),
  fromZone: gameZoneSchema.default("hand"),
  targets: z.array(gameActionTargetSchema).default([]),
  manaSpent: z.string().min(1).optional(),
});

export const activateAbilityActionSchema = gameActionBaseSchema.extend({
  type: z.literal("activateAbility"),
  abilityText: z.string().min(1).optional(),
  targets: z.array(gameActionTargetSchema).default([]),
});

export const triggerNotedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("triggerNoted"),
  triggerText: z.string().min(1).optional(),
  targets: z.array(gameActionTargetSchema).default([]),
});

export const combatantSchema = z.object({
  objectRef: z.string().min(1).optional(),
  cardRef: gameActionCardRefSchema.optional(),
});

export const declareAttackersActionSchema = gameActionBaseSchema.extend({
  type: z.literal("declareAttackers"),
  attackers: z
    .array(
      combatantSchema.extend({
        defendingTarget: gameActionTargetSchema.optional(),
      }),
    )
    .default([]),
});

export const declareBlockersActionSchema = gameActionBaseSchema.extend({
  type: z.literal("declareBlockers"),
  blockers: z
    .array(
      combatantSchema.extend({
        blockedAttacker: combatantSchema.optional(),
      }),
    )
    .default([]),
});

export const damageDealtActionSchema = gameActionBaseSchema.extend({
  type: z.literal("damageDealt"),
  amount: z.number().int().nonnegative(),
  targets: z.array(gameActionTargetSchema).default([]),
});

export const lifeChangedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("lifeChanged"),
  playerRef: z.string().min(1),
  delta: z.number().int(),
  newTotal: z.number().int().optional(),
});

export const zoneTransferActionSchema = gameActionBaseSchema.extend({
  type: z.literal("zoneTransfer"),
  fromZone: gameZoneSchema,
  toZone: gameZoneSchema,
});

export const mulliganDecisionActionSchema = gameActionBaseSchema.extend({
  type: z.literal("mulliganDecision"),
  decision: z.enum(["keep", "mulligan"]),
  handSize: z.number().int().nonnegative().optional(),
});

export const turnBeganActionSchema = gameActionBaseSchema.extend({
  type: z.literal("turnBegan"),
  turnNumber: z.number().int().positive(),
});

export const phaseChangedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("phaseChanged"),
  phase: z.string().min(1),
  step: z.string().min(1).optional(),
});

export const priorityPassedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("priorityPassed"),
});

export const gameStartedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("gameStarted"),
  players: z.array(z.string().min(1)).default([]),
  onThePlay: z.string().min(1).optional(),
});

export const gameEndedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("gameEnded"),
  winnerRef: z.string().min(1).optional(),
  outcome: z.enum(["win", "draw", "unknown"]).optional(),
  reason: z.string().min(1).optional(),
});

export const manualNoteActionSchema = gameActionBaseSchema.extend({
  type: z.literal("manualNote"),
  note: z.string().min(1),
});

export const undoAppliedActionSchema = gameActionBaseSchema.extend({
  type: z.literal("undoApplied"),
  undoneEventId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const gameActionSchema = z.discriminatedUnion("type", [
  playLandActionSchema,
  castSpellActionSchema,
  activateAbilityActionSchema,
  triggerNotedActionSchema,
  declareAttackersActionSchema,
  declareBlockersActionSchema,
  damageDealtActionSchema,
  lifeChangedActionSchema,
  zoneTransferActionSchema,
  mulliganDecisionActionSchema,
  turnBeganActionSchema,
  phaseChangedActionSchema,
  priorityPassedActionSchema,
  gameStartedActionSchema,
  gameEndedActionSchema,
  manualNoteActionSchema,
  undoAppliedActionSchema,
]);

export const gameActionTypeSchema = z.enum([
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

export type GameActionCardRef = z.infer<typeof gameActionCardRefSchema>;
export type GameZone = z.infer<typeof gameZoneSchema>;
export type GameActionTarget = z.infer<typeof gameActionTargetSchema>;
export type GameAction = z.infer<typeof gameActionSchema>;
export type GameActionType = z.infer<typeof gameActionTypeSchema>;
export type PlayLandAction = z.infer<typeof playLandActionSchema>;
export type CastSpellAction = z.infer<typeof castSpellActionSchema>;
export type ActivateAbilityAction = z.infer<typeof activateAbilityActionSchema>;
export type TriggerNotedAction = z.infer<typeof triggerNotedActionSchema>;
export type DeclareAttackersAction = z.infer<typeof declareAttackersActionSchema>;
export type DeclareBlockersAction = z.infer<typeof declareBlockersActionSchema>;
export type DamageDealtAction = z.infer<typeof damageDealtActionSchema>;
export type LifeChangedAction = z.infer<typeof lifeChangedActionSchema>;
export type ZoneTransferAction = z.infer<typeof zoneTransferActionSchema>;
export type MulliganDecisionAction = z.infer<typeof mulliganDecisionActionSchema>;
export type TurnBeganAction = z.infer<typeof turnBeganActionSchema>;
export type PhaseChangedAction = z.infer<typeof phaseChangedActionSchema>;
export type PriorityPassedAction = z.infer<typeof priorityPassedActionSchema>;
export type GameStartedAction = z.infer<typeof gameStartedActionSchema>;
export type GameEndedAction = z.infer<typeof gameEndedActionSchema>;
export type ManualNoteAction = z.infer<typeof manualNoteActionSchema>;
export type UndoAppliedAction = z.infer<typeof undoAppliedActionSchema>;
