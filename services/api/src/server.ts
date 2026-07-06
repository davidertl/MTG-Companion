import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { ZodError } from "zod";

import {
  createInMemoryEventStore,
  resolveStore,
  type BackendStoreLike,
} from "./domain/eventService.ts";
import { createInMemorySyncStore, type SyncStore } from "./domain/syncService.ts";
import { mediaSessionsRoute } from "./routes/media/index.ts";
import {
  ArchidektImportRouteError,
  buildArchidektImportRoute,
  buildRuntimeArchidektFetcher,
  type ArchidektFetcher,
} from "./routes/integrations/archidekt/import.ts";
import { eventsRoute } from "./routes/events.ts";
import { eventsPullRoute } from "./routes/eventsPull.ts";
import { syncRoute } from "./routes/sync.ts";
import { AuthError, UnauthorizedError } from "./auth/roles.ts";
import {
  parseBearerToken,
  registerUser,
  resolveUserFromToken,
  type AuthenticatedUser,
} from "./auth/tokens.ts";
import {
  addTournamentMemberRoute,
  createTournamentRoute,
  getMyRoleRoute,
} from "./routes/tournaments/index.ts";
import type { Store } from "./store/types.ts";

export interface ApiServerOptions {
  store?: SyncStore;
  eventStore?: BackendStoreLike;
  archidektFetcher?: ArchidektFetcher;
  /**
   * Enables `POST /auth/register`. Defaults to the `MANCUTG_ALLOW_REGISTRATION`
   * env var (any of `1`/`true`/`yes`/`on`). Registration is off by default so a
   * default backend deployment does not silently mint accounts.
   */
  allowRegistration?: boolean;
}

function registrationEnabledFromEnv(): boolean {
  const value = (process.env.MANCUTG_ALLOW_REGISTRATION ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export interface StartedApiServer {
  server: Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const store = options.store ?? createInMemorySyncStore();
  const eventStore = options.eventStore ?? createInMemoryEventStore();
  // Auth/identity data lives in the same backend as events/media. Resolve it
  // once to the Store interface (a legacy JSON bag is wrapped in an adapter over
  // the shared bag, so all routes observe the same data).
  const authStore: Store = resolveStore(eventStore);
  const allowRegistration = options.allowRegistration ?? registrationEnabledFromEnv();
  const importDeck = buildArchidektImportRoute(
    options.archidektFetcher ?? buildRuntimeArchidektFetcher(),
  );

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { status: "ok" });
      }

      if (method === "POST" && url.pathname === "/sync") {
        const body = await readJsonBody(request);
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : undefined;
        const result = syncRoute(body, token, store);
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/events") {
        const result = eventsPullRoute(
          {
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
            tournamentId: url.searchParams.get("tournamentId") ?? undefined,
          },
          eventStore,
        );
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/events") {
        const body = await readJsonBody(request);
        const result = eventsRoute(body, eventStore);
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/media/sessions") {
        const body = await readJsonBody(request);
        const result = mediaSessionsRoute(body, eventStore);
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname.startsWith("/integrations/archidekt/")) {
        const deckId = decodeURIComponent(url.pathname.slice("/integrations/archidekt/".length));
        const snapshot = await importDeck(deckId);
        return sendJson(response, 200, snapshot);
      }

      // --- Auth + tournament-scoped routes (W2.3) ----------------------------
      // These are the ONLY routes that require authentication. Everything above
      // stays anonymous (offline-first: desktop sync without an account works).

      if (method === "POST" && url.pathname === "/auth/register") {
        if (!allowRegistration) {
          return sendJson(response, 403, { error: "registration-disabled" });
        }
        const body = (await readJsonBody(request)) as { displayName?: unknown } | null;
        const displayName =
          typeof body?.displayName === "string" ? body.displayName.trim() : "";
        if (displayName.length === 0) {
          return sendJson(response, 400, { error: "invalid-request" });
        }
        const result = registerUser(authStore, displayName);
        return sendJson(response, 201, result);
      }

      const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

      if (segments[0] === "tournaments") {
        const user = requireAuthenticatedUser(authStore, request);

        if (method === "POST" && segments.length === 1) {
          const body = await readJsonBody(request);
          return sendJson(response, 201, createTournamentRoute(authStore, user, body));
        }

        if (segments.length === 3) {
          const tournamentId = decodeURIComponent(segments[1]);

          if (method === "POST" && segments[2] === "members") {
            const body = await readJsonBody(request);
            return sendJson(
              response,
              201,
              addTournamentMemberRoute(authStore, user, tournamentId, body),
            );
          }

          if (method === "GET" && segments[2] === "role") {
            return sendJson(response, 200, getMyRoleRoute(authStore, user, tournamentId));
          }
        }

        return sendJson(response, 404, { error: "not-found" });
      }

      return sendJson(response, 404, { error: "not-found" });
    } catch (error) {
      if (error instanceof ZodError) {
        return sendJson(response, 400, { error: "invalid-request" });
      }

      if (error instanceof AuthError) {
        return sendJson(response, error.status, { error: error.code });
      }

      if (error instanceof ArchidektImportRouteError) {
        return sendJson(response, error.status, { error: error.code });
      }

      const message = error instanceof Error ? error.message : "unknown error";
      return sendJson(response, 400, { error: message });
    }
  });
}

export async function startApiServer(
  port: number,
  options: ApiServerOptions = {},
): Promise<StartedApiServer> {
  const server = createApiServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve listening address");
  }

  return {
    server,
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function requireAuthenticatedUser(store: Store, request: IncomingMessage): AuthenticatedUser {
  const token = parseBearerToken(request.headers.authorization);
  const user = resolveUserFromToken(store, token);
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return null;
  }

  return JSON.parse(raw);
}
