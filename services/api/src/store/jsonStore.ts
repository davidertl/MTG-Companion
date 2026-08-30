import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  backendEventEnvelopeSchema,
  backendEventSessionSchema,
  mediaArtifactSchema,
  mediaCaptureSessionSchema,
  tournamentMembershipSchema,
  tournamentSettingsSchema,
  type BackendEventEnvelope,
  type BackendEventSession,
  type MediaArtifact,
  type MediaCaptureSession,
  type TournamentMembership,
} from "../../../../packages/shared-schema/src/index.ts";
import {
  validatePapercEventContract,
  validatePapercSessionContract,
} from "../../../../packages/shared-schema/src/paperc.ts";

import {
  eventTournamentId,
  isStore,
  type BatchKeyScope,
  type Store,
  type StoredEvent,
  type StoredToken,
  type StoredTournament,
  type StoredUser,
} from "./types.ts";

type PersistedStoreFile = {
  sessions: BackendEventSession[];
  events: BackendEventEnvelope[];
  seenBatchKeys: string[];
  mediaSessions: MediaCaptureSession[];
  mediaArtifacts: MediaArtifact[];
  seenMediaBatchKeys: string[];
  users: StoredUser[];
  authTokens: StoredToken[];
  tournaments: StoredTournament[];
  memberships: TournamentMembership[];
};

/**
 * Legacy JSON-file / in-memory store shape. Kept for backward compatibility:
 * existing callers and tests construct this bag directly and inspect its
 * arrays. New code should depend on the `Store` interface instead.
 */
export interface EventStore {
  filePath?: string;
  sessions: BackendEventSession[];
  events: BackendEventEnvelope[];
  seenBatchKeys: string[];
  mediaSessions: MediaCaptureSession[];
  mediaArtifacts: MediaArtifact[];
  seenMediaBatchKeys: string[];
  users: StoredUser[];
  authTokens: StoredToken[];
  tournaments: StoredTournament[];
  memberships: TournamentMembership[];
}

/** Anything the domain services accept as persistence backend. */
export type BackendStoreLike = EventStore | Store;

export function createInMemoryEventStore(): EventStore {
  return {
    filePath: undefined,
    sessions: [],
    events: [],
    seenBatchKeys: [],
    mediaSessions: [],
    mediaArtifacts: [],
    seenMediaBatchKeys: [],
    users: [],
    authTokens: [],
    tournaments: [],
    memberships: [],
  };
}

export function createPersistentEventStore(filePath: string): EventStore {
  if (!existsSync(filePath)) {
    return {
      ...createInMemoryEventStore(),
      filePath,
    };
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = parsePersistedStore(JSON.parse(raw));
  return {
    filePath,
    ...parsed,
  };
}

/**
 * Normalizes either store flavour to the `Store` interface. Legacy bags are
 * wrapped in an adapter that mutates the bag in place, so callers holding the
 * bag keep observing updates (and JSON persistence keeps working).
 */
export function resolveStore(store: BackendStoreLike): Store {
  return isStore(store) ? store : new JsonEventStoreAdapter(store);
}

export class JsonEventStoreAdapter implements Store {
  private readonly bag: EventStore;

  constructor(bag: EventStore) {
    this.bag = bag;
  }

  transaction<T>(work: () => T): T {
    const snapshot: Omit<EventStore, "filePath"> = {
      sessions: [...this.bag.sessions],
      events: [...this.bag.events],
      seenBatchKeys: [...this.bag.seenBatchKeys],
      mediaSessions: [...this.bag.mediaSessions],
      mediaArtifacts: [...this.bag.mediaArtifacts],
      seenMediaBatchKeys: [...this.bag.seenMediaBatchKeys],
      users: [...this.bag.users],
      authTokens: [...this.bag.authTokens],
      tournaments: [...this.bag.tournaments],
      memberships: [...this.bag.memberships],
    };

    try {
      const result = work();
      persistStore(this.bag);
      return result;
    } catch (error) {
      Object.assign(this.bag, snapshot);
      throw error;
    }
  }

  hasSeenBatchKey(scope: BatchKeyScope, key: string): boolean {
    return this.batchKeys(scope).includes(key);
  }

  rememberBatchKey(scope: BatchKeyScope, key: string): void {
    this.batchKeys(scope).push(key);
  }

  hasSession(sourceApp: string, sourceSessionId: string): boolean {
    return this.sessionIndex(sourceApp, sourceSessionId) >= 0;
  }

  upsertSession(session: BackendEventSession): void {
    const index = this.sessionIndex(session.sourceApp, session.sourceSessionId);
    if (index >= 0) {
      this.bag.sessions[index] = session;
    } else {
      this.bag.sessions.push(session);
    }
  }

  countSessions(): number {
    return this.bag.sessions.length;
  }

  hasEvent(sourceApp: string, sourceSessionId: string, eventId: string): boolean {
    return this.bag.events.some(
      (event) =>
        event.sourceApp === sourceApp &&
        event.sourceSessionId === sourceSessionId &&
        event.eventId === eventId,
    );
  }

  appendEvent(event: BackendEventEnvelope): number {
    this.bag.events.push(event);
    return this.bag.events.length;
  }

  countEvents(): number {
    return this.bag.events.length;
  }

  readEventsAfter(cursor: number, limit: number, tournamentId?: string): StoredEvent[] {
    const page: StoredEvent[] = [];
    for (let index = 0; index < this.bag.events.length; index += 1) {
      const eventCursor = index + 1;
      if (eventCursor <= cursor) {
        continue;
      }
      const event = this.bag.events[index];
      if (tournamentId !== undefined && eventTournamentId(event) !== tournamentId) {
        continue;
      }
      page.push({ cursor: eventCursor, event });
      if (page.length >= limit) {
        break;
      }
    }
    return page;
  }

  hasMediaSession(captureSessionId: string): boolean {
    return this.mediaSessionIndex(captureSessionId) >= 0;
  }

  upsertMediaSession(session: MediaCaptureSession): void {
    const index = this.mediaSessionIndex(session.captureSessionId);
    if (index >= 0) {
      this.bag.mediaSessions[index] = session;
    } else {
      this.bag.mediaSessions.push(session);
    }
  }

  countMediaSessions(): number {
    return this.bag.mediaSessions.length;
  }

  hasMediaArtifact(captureSessionId: string, artifactId: string): boolean {
    return this.bag.mediaArtifacts.some(
      (artifact) =>
        artifact.captureSessionId === captureSessionId &&
        artifact.artifactId === artifactId,
    );
  }

  addMediaArtifact(artifact: MediaArtifact): void {
    this.bag.mediaArtifacts.push(artifact);
  }

  countMediaArtifacts(): number {
    return this.bag.mediaArtifacts.length;
  }

  insertUser(user: StoredUser): void {
    this.bag.users.push(user);
  }

  getUser(userId: string): StoredUser | undefined {
    return this.bag.users.find((user) => user.userId === userId);
  }

  insertToken(token: StoredToken): void {
    this.bag.authTokens.push(token);
  }

  findUserIdByTokenHash(tokenHash: string): string | undefined {
    return this.bag.authTokens.find((token) => token.tokenHash === tokenHash)?.userId;
  }

  insertTournament(tournament: StoredTournament): void {
    this.bag.tournaments.push(tournament);
  }

  getTournament(tournamentId: string): StoredTournament | undefined {
    return this.bag.tournaments.find(
      (tournament) => tournament.tournamentId === tournamentId,
    );
  }

  upsertMembership(membership: TournamentMembership): void {
    const index = this.bag.memberships.findIndex(
      (existing) =>
        existing.tournamentId === membership.tournamentId &&
        existing.userId === membership.userId,
    );
    if (index >= 0) {
      this.bag.memberships[index] = membership;
    } else {
      this.bag.memberships.push(membership);
    }
  }

  getMembership(
    tournamentId: string,
    userId: string,
  ): TournamentMembership | undefined {
    return this.bag.memberships.find(
      (membership) =>
        membership.tournamentId === tournamentId && membership.userId === userId,
    );
  }

  listMemberships(tournamentId: string): TournamentMembership[] {
    return this.bag.memberships
      .filter((membership) => membership.tournamentId === tournamentId)
      .sort((left, right) => left.userId.localeCompare(right.userId));
  }

  private batchKeys(scope: BatchKeyScope): string[] {
    return scope === "events" ? this.bag.seenBatchKeys : this.bag.seenMediaBatchKeys;
  }

  private sessionIndex(sourceApp: string, sourceSessionId: string): number {
    return this.bag.sessions.findIndex(
      (session) =>
        session.sourceApp === sourceApp && session.sourceSessionId === sourceSessionId,
    );
  }

  private mediaSessionIndex(captureSessionId: string): number {
    return this.bag.mediaSessions.findIndex(
      (session) => session.captureSessionId === captureSessionId,
    );
  }
}

function persistStore(store: EventStore): void {
  if (!store.filePath) {
    return;
  }

  const persisted: PersistedStoreFile = {
    sessions: store.sessions,
    events: store.events,
    seenBatchKeys: store.seenBatchKeys,
    mediaSessions: store.mediaSessions,
    mediaArtifacts: store.mediaArtifacts,
    seenMediaBatchKeys: store.seenMediaBatchKeys,
    users: store.users,
    authTokens: store.authTokens,
    tournaments: store.tournaments,
    memberships: store.memberships,
  };
  const tempPath = `${store.filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(persisted, null, 2));
  renameSync(tempPath, store.filePath);
}

function parsePersistedStore(input: unknown): PersistedStoreFile {
  const object = (input ?? {}) as Partial<PersistedStoreFile>;
  return {
    sessions: Array.isArray(object.sessions)
      ? object.sessions.map((session) =>
          validatePapercSessionContract(backendEventSessionSchema.parse(session)),
        )
      : [],
    events: Array.isArray(object.events)
      ? object.events.map((event) =>
          validatePapercEventContract(backendEventEnvelopeSchema.parse(event)),
        )
      : [],
    seenBatchKeys: Array.isArray(object.seenBatchKeys)
      ? object.seenBatchKeys.filter((item): item is string => typeof item === "string")
      : [],
    mediaSessions: Array.isArray(object.mediaSessions)
      ? object.mediaSessions.map((session) => mediaCaptureSessionSchema.parse(session))
      : [],
    mediaArtifacts: Array.isArray(object.mediaArtifacts)
      ? object.mediaArtifacts.map((artifact) => mediaArtifactSchema.parse(artifact))
      : [],
    seenMediaBatchKeys: Array.isArray(object.seenMediaBatchKeys)
      ? object.seenMediaBatchKeys.filter((item): item is string => typeof item === "string")
      : [],
    users: Array.isArray(object.users)
      ? object.users.filter(isStoredUser)
      : [],
    authTokens: Array.isArray(object.authTokens)
      ? object.authTokens.filter(isStoredToken)
      : [],
    tournaments: Array.isArray(object.tournaments)
      ? object.tournaments.map(parseStoredTournament)
      : [],
    memberships: Array.isArray(object.memberships)
      ? object.memberships.map((membership) =>
          tournamentMembershipSchema.parse(membership),
        )
      : [],
  };
}

function isStoredUser(candidate: unknown): candidate is StoredUser {
  const user = candidate as Partial<StoredUser> | null;
  return (
    typeof user === "object" &&
    user !== null &&
    typeof user.userId === "string" &&
    typeof user.displayName === "string" &&
    typeof user.createdAt === "string"
  );
}

function isStoredToken(candidate: unknown): candidate is StoredToken {
  const token = candidate as Partial<StoredToken> | null;
  return (
    typeof token === "object" &&
    token !== null &&
    typeof token.tokenHash === "string" &&
    typeof token.userId === "string" &&
    typeof token.createdAt === "string"
  );
}

function parseStoredTournament(candidate: unknown): StoredTournament {
  const raw = (candidate ?? {}) as Record<string, unknown>;
  return {
    tournamentId: String(raw.tournamentId),
    name: typeof raw.name === "string" ? raw.name : undefined,
    settings: tournamentSettingsSchema.parse(raw.settings ?? {}),
    createdBy: String(raw.createdBy),
    createdAt: String(raw.createdAt),
  };
}
