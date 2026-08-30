/**
 * Palette action factories (plan 2026-07-06-001 W2.2).
 *
 * Each UI palette entry maps to exactly one typed `gameActions` payload from the
 * frozen shared contract. Keeping the construction here (rather than inline in
 * the React shell) makes the mapping unit-testable and keeps the reducer generic.
 */

import type {
  GameAction,
  GameActionCardRef,
} from "../../../../packages/shared-schema/src/index";

function cardRef(name?: string): GameActionCardRef | undefined {
  const trimmed = name?.trim();
  return trimmed ? { name: trimmed } : undefined;
}

export function playLand(actor: string, cardName?: string): GameAction {
  return { type: "playLand", actor, fromZone: "hand", cardRef: cardRef(cardName) };
}

export function castSpell(actor: string, cardName?: string): GameAction {
  return {
    type: "castSpell",
    actor,
    fromZone: "hand",
    targets: [],
    cardRef: cardRef(cardName),
  };
}

export function activateAbility(
  actor: string,
  cardName?: string,
  abilityText?: string,
): GameAction {
  return {
    type: "activateAbility",
    actor,
    targets: [],
    cardRef: cardRef(cardName),
    ...(abilityText?.trim() ? { abilityText: abilityText.trim() } : {}),
  };
}

export function declareAttackers(actor: string, attackerNames: string[]): GameAction {
  return {
    type: "declareAttackers",
    actor,
    attackers: attackerNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => ({ cardRef: { name } })),
  };
}

export function declareBlockers(actor: string, blockerNames: string[]): GameAction {
  return {
    type: "declareBlockers",
    actor,
    blockers: blockerNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => ({ cardRef: { name } })),
  };
}

export function lifeChanged(playerRef: string, delta: number): GameAction {
  return { type: "lifeChanged", actor: playerRef, playerRef, delta };
}

export function triggerNoted(actor: string, triggerText?: string): GameAction {
  return {
    type: "triggerNoted",
    actor,
    targets: [],
    ...(triggerText?.trim() ? { triggerText: triggerText.trim() } : {}),
  };
}

export function manualNote(actor: string, note: string): GameAction {
  return { type: "manualNote", actor, note };
}

export function turnBegan(actor: string, turnNumber: number): GameAction {
  return { type: "turnBegan", actor, turnNumber };
}

export function phaseChanged(actor: string, phase: string, step?: string): GameAction {
  return {
    type: "phaseChanged",
    actor,
    phase,
    ...(step?.trim() ? { step: step.trim() } : {}),
  };
}

export function gameStarted(players: string[], onThePlay?: string): GameAction {
  return {
    type: "gameStarted",
    actor: onThePlay ?? players[0] ?? "player1",
    players,
    ...(onThePlay ? { onThePlay } : {}),
  };
}

export function gameEnded(
  actor: string,
  winnerRef?: string,
  outcome?: "win" | "draw" | "unknown",
): GameAction {
  return {
    type: "gameEnded",
    actor,
    ...(winnerRef ? { winnerRef } : {}),
    ...(outcome ? { outcome } : {}),
  };
}

/** Ordered phase labels used by the turn/phase stepper. */
export const PHASES: string[] = [
  "beginning",
  "main-1",
  "combat",
  "main-2",
  "end",
];

/** Palette entries requiring a card-name input, for the UI to branch on. */
export type PaletteKind =
  | "playLand"
  | "castSpell"
  | "activateAbility"
  | "declareAttackers"
  | "declareBlockers"
  | "lifeChange"
  | "triggerNoted"
  | "manualNote";

export const PALETTE: { kind: PaletteKind; label: string; needsCard: boolean }[] = [
  { kind: "playLand", label: "Play land", needsCard: true },
  { kind: "castSpell", label: "Cast spell", needsCard: true },
  { kind: "activateAbility", label: "Activate ability", needsCard: true },
  { kind: "declareAttackers", label: "Attack", needsCard: true },
  { kind: "declareBlockers", label: "Block", needsCard: true },
  { kind: "lifeChange", label: "Life change", needsCard: false },
  { kind: "triggerNoted", label: "Trigger noted", needsCard: false },
  { kind: "manualNote", label: "Manual note", needsCard: false },
];
