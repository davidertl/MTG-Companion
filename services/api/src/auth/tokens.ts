import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Store } from "../store/types.ts";

/**
 * Minimal opaque bearer-token auth (plan unit W2.3).
 *
 * Design is deliberately boring: a registration endpoint mints a random,
 * high-entropy opaque token and hands it to the caller once. Only the sha256
 * hash of the token is stored at rest (`node:crypto`, no external deps), so a
 * leak of the store never reveals live tokens. There is no password, session,
 * OAuth, refresh, or reset flow — those are out of scope for this plan.
 */

export interface AuthenticatedUser {
  userId: string;
  displayName: string;
}

export interface RegistrationResult {
  userId: string;
  displayName: string;
  /** Plaintext token — returned exactly once, never persisted in the clear. */
  token: string;
}

/** 256 bits of entropy, URL-safe so it slots straight into an Authorization header. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a user and issues its first token. Wrapped in a store transaction so
 * the JSON backend flushes to disk and the SQLite backend commits atomically.
 */
export function registerUser(store: Store, displayName: string): RegistrationResult {
  const userId = randomUUID();
  const token = generateToken();
  const createdAt = new Date().toISOString();

  store.transaction(() => {
    store.insertUser({ userId, displayName, createdAt });
    store.insertToken({ tokenHash: hashToken(token), userId, createdAt });
  });

  return { userId, displayName, token };
}

/** Extracts the raw token from an `Authorization: Bearer <token>` header. */
export function parseBearerToken(authorization?: string | null): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return undefined;
  }
  const token = authorization.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Resolves a bearer token to its user, or `null` when the token is absent or
 * unknown. Callers that require auth should treat `null` as a 401.
 */
export function resolveUserFromToken(
  store: Store,
  token: string | undefined,
): AuthenticatedUser | null {
  if (!token) {
    return null;
  }
  const userId = store.findUserIdByTokenHash(hashToken(token));
  if (!userId) {
    return null;
  }
  const user = store.getUser(userId);
  if (!user) {
    return null;
  }
  return { userId: user.userId, displayName: user.displayName };
}
