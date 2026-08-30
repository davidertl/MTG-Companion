import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  tournamentRoleSchema,
  tournamentSettingsSchema,
  type TournamentMembership,
  type TournamentRole,
} from "../../../../../packages/shared-schema/src/index.ts";
import { NotFoundError, requireRole } from "../../auth/roles.ts";
import type { AuthenticatedUser } from "../../auth/tokens.ts";
import type { Store, StoredTournament } from "../../store/types.ts";

/**
 * Tournament-scoped routes (plan W2.3). Every handler here requires an
 * authenticated user — the server resolves the bearer token before dispatch and
 * rejects anonymous callers with 401. Membership roles gate mutations.
 */

const createTournamentSchema = z.object({
  tournamentId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  settings: tournamentSettingsSchema.optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: tournamentRoleSchema,
});

export interface TournamentView {
  tournamentId: string;
  name?: string;
  settings: StoredTournament["settings"];
  createdBy: string;
  createdAt: string;
}

export interface CreateTournamentResult {
  tournament: TournamentView;
  membership: TournamentMembership;
}

export interface AddMemberResult {
  membership: TournamentMembership;
}

export interface MyRoleResult {
  tournamentId: string;
  userId: string;
  role: TournamentRole | null;
}

function toView(tournament: StoredTournament): TournamentView {
  return {
    tournamentId: tournament.tournamentId,
    name: tournament.name,
    settings: tournament.settings,
    createdBy: tournament.createdBy,
    createdAt: tournament.createdAt,
  };
}

/**
 * Creates a tournament and makes the caller its organizer. Idempotent-ish: a
 * caller-supplied `tournamentId` that already exists is rejected as a conflict.
 */
export function createTournamentRoute(
  store: Store,
  user: AuthenticatedUser,
  input: unknown,
): CreateTournamentResult {
  const body = createTournamentSchema.parse(input ?? {});
  const tournamentId = body.tournamentId ?? randomUUID();

  if (store.getTournament(tournamentId)) {
    throw new NotFoundError("tournament-already-exists");
  }

  const tournament: StoredTournament = {
    tournamentId,
    name: body.name,
    settings: tournamentSettingsSchema.parse(body.settings ?? {}),
    createdBy: user.userId,
    createdAt: new Date().toISOString(),
  };

  const membership: TournamentMembership = {
    tournamentId,
    userId: user.userId,
    role: "organizer",
  };

  store.transaction(() => {
    store.insertTournament(tournament);
    store.upsertMembership(membership);
  });

  return { tournament: toView(tournament), membership };
}

/** Adds (or re-roles) a member. Organizer-only. */
export function addTournamentMemberRoute(
  store: Store,
  user: AuthenticatedUser,
  tournamentId: string,
  input: unknown,
): AddMemberResult {
  requireRole(store, tournamentId, user, ["organizer"]);

  const body = addMemberSchema.parse(input ?? {});
  if (!store.getUser(body.userId)) {
    throw new NotFoundError("user-not-found");
  }

  const membership: TournamentMembership = {
    tournamentId,
    userId: body.userId,
    role: body.role,
  };

  store.transaction(() => {
    store.upsertMembership(membership);
  });

  return { membership };
}

/** Returns the caller's role in a tournament (`null` when not a member). */
export function getMyRoleRoute(
  store: Store,
  user: AuthenticatedUser,
  tournamentId: string,
): MyRoleResult {
  if (!store.getTournament(tournamentId)) {
    throw new NotFoundError("tournament-not-found");
  }
  const membership = store.getMembership(tournamentId, user.userId);
  return {
    tournamentId,
    userId: user.userId,
    role: membership?.role ?? null,
  };
}
