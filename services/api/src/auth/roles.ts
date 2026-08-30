import type {
  TournamentMembership,
  TournamentRole,
} from "../../../../packages/shared-schema/src/index.ts";
import type { Store } from "../store/types.ts";

import type { AuthenticatedUser } from "./tokens.ts";

/**
 * Per-tournament role membership access + a `requireRole` guard (plan W2.3).
 * Roles are scoped per tournament: a user holds at most one role per
 * tournament, and no role at all in tournaments they are not a member of. This
 * is the substrate W3.3 uses to enforce referee-only finding visibility.
 */

/** Base class for auth failures the HTTP layer maps to a status + error code. */
export class AuthError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/** No valid bearer token was presented for a route that requires one. */
export class UnauthorizedError extends AuthError {
  constructor(code: string = "unauthorized") {
    super(401, code);
    this.name = "UnauthorizedError";
  }
}

/** Authenticated, but the user's role does not permit the action. */
export class ForbiddenError extends AuthError {
  constructor(code: string = "forbidden") {
    super(403, code);
    this.name = "ForbiddenError";
  }
}

/** The referenced tournament (or other resource) does not exist. */
export class NotFoundError extends AuthError {
  constructor(code: string = "not-found") {
    super(404, code);
    this.name = "NotFoundError";
  }
}

/** Returns the user's role in a tournament, or `undefined` if not a member. */
export function getMembershipRole(
  store: Store,
  tournamentId: string,
  userId: string,
): TournamentRole | undefined {
  return store.getMembership(tournamentId, userId)?.role;
}

export function listTournamentMemberships(
  store: Store,
  tournamentId: string,
): TournamentMembership[] {
  return store.listMemberships(tournamentId);
}

/**
 * Guard: asserts the authenticated user holds one of `roles` in the tournament.
 * Throws `NotFoundError` if the tournament is unknown, `ForbiddenError` if the
 * user's role is not permitted. Returns the user's role on success.
 */
export function requireRole(
  store: Store,
  tournamentId: string,
  user: AuthenticatedUser,
  roles: TournamentRole[],
): TournamentRole {
  if (!store.getTournament(tournamentId)) {
    throw new NotFoundError("tournament-not-found");
  }
  const role = getMembershipRole(store, tournamentId, user.userId);
  if (!role || !roles.includes(role)) {
    throw new ForbiddenError("insufficient-role");
  }
  return role;
}
