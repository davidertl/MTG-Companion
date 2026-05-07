import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { ZodError } from "zod";

import { createInMemoryEventStore, type EventStore } from "./domain/eventService.ts";
import { createInMemorySyncStore, type SyncStore } from "./domain/syncService.ts";
import { mediaSessionsRoute } from "./routes/media/index.ts";
import {
  ArchidektImportRouteError,
  buildArchidektImportRoute,
  buildRuntimeArchidektFetcher,
  type ArchidektFetcher,
} from "./routes/integrations/archidekt/import.ts";
import { eventsRoute } from "./routes/events.ts";
import { ingestBatchesRoute } from "./routes/ingest/batches.ts";
import { eventRoute } from "./routes/read/events.ts";
import { gamesRoute } from "./routes/read/games.ts";
import { createLiveHub, type LiveHub } from "./routes/read/live.ts";
import { overviewRoute } from "./routes/read/overview.ts";
import { resolveReviewRoute, reviewQueueRoute } from "./routes/read/reviewQueue.ts";
import { sessionEventsRoute, sessionRoute, sessionsRoute } from "./routes/read/sessions.ts";
import { syncRoute } from "./routes/sync.ts";
import { SqliteClient } from "./storage/sqlite/client.ts";

export interface ApiServerOptions {
  store?: SyncStore;
  eventStore?: EventStore;
  archidektFetcher?: ArchidektFetcher;
  sqlite?: SqliteClient;
  liveHub?: LiveHub;
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
  const sqlite = options.sqlite;
  const liveHub = options.liveHub ?? createLiveHub();
  const importDeck = buildArchidektImportRoute(
    options.archidektFetcher ?? buildRuntimeArchidektFetcher(),
  );

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (method === "OPTIONS") {
        return handleCorsPreflight(request, response);
      }
      if (!applyCorsHeaders(request, response)) {
        return sendJson(response, 403, { error: "cors-origin-denied" });
      }

      if (method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { status: "ok", storage: sqlite ? "sqlite" : "memory" });
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

      if (method === "POST" && url.pathname === "/events") {
        const body = await readJsonBody(request);
        const result = eventsRoute(body, eventStore);
        return sendJson(response, 200, result);
      }

      if (sqlite && method === "POST" && url.pathname === "/v1/ingest/batches") {
        const body = await readJsonBody(request);
        const result = ingestBatchesRoute(body, sqlite);
        if (result.status === 200) {
          liveHub.publish({ type: "ingest.accepted", payload: result.payload });
        }
        return sendJson(response, result.status, result.payload);
      }

      if (method === "POST" && url.pathname === "/v1/ingest/raw-log") {
        if (process.env.MANCUTG_ENABLE_RAW_LOG_INGEST !== "true") {
          return sendJson(response, 403, { error: "raw-log-upload-disabled" });
        }
        return sendJson(response, 501, { error: "raw-log-upload-not-implemented" });
      }

      if (method === "POST" && url.pathname === "/media/sessions") {
        const body = await readJsonBody(request);
        const result = mediaSessionsRoute(body, eventStore);
        return sendJson(response, 200, result);
      }

      if (sqlite && method === "GET" && url.pathname === "/v1/live") {
        const unsubscribe = liveHub.subscribe(response);
        request.on("close", unsubscribe);
        return;
      }

      if (sqlite && method === "GET" && url.pathname === "/v1/overview") {
        return sendJson(response, 200, overviewRoute(sqlite));
      }

      if (sqlite && method === "GET" && url.pathname === "/v1/games") {
        return sendJson(response, 200, gamesRoute(sqlite));
      }

      if (sqlite && method === "GET" && url.pathname === "/v1/sessions") {
        return sendJson(
          response,
          200,
          sessionsRoute(sqlite, {
            game: url.searchParams.get("game") ?? undefined,
            mode: url.searchParams.get("mode") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
          }),
        );
      }

      if (sqlite && method === "GET" && url.pathname.startsWith("/v1/sessions/")) {
        const path = url.pathname.slice("/v1/sessions/".length);
        if (path.endsWith("/events")) {
          const sessionId = decodeURIComponent(path.slice(0, -"/events".length));
          return sendJson(response, 200, sessionEventsRoute(sqlite, sessionId));
        }
        const item = sessionRoute(sqlite, decodeURIComponent(path));
        if (!item) {
          return sendJson(response, 404, { error: "not-found" });
        }
        return sendJson(response, 200, item);
      }

      if (sqlite && method === "GET" && url.pathname.startsWith("/v1/events/")) {
        const item = eventRoute(sqlite, decodeURIComponent(url.pathname.slice("/v1/events/".length)));
        if (!item) {
          return sendJson(response, 404, { error: "not-found" });
        }
        return sendJson(response, 200, item);
      }

      if (sqlite && method === "GET" && url.pathname === "/v1/review-queue") {
        return sendJson(response, 200, reviewQueueRoute(sqlite));
      }

      if (sqlite && method === "POST" && url.pathname.startsWith("/v1/review-queue/")) {
        const suffix = url.pathname.slice("/v1/review-queue/".length);
        if (!suffix.endsWith("/resolve")) {
          return sendJson(response, 404, { error: "not-found" });
        }
        const eventId = decodeURIComponent(suffix.slice(0, -"/resolve".length));
        const body = await readJsonBody(request);
        try {
          const result = resolveReviewRoute(sqlite, eventId, body);
          liveHub.publish({ type: "review.resolved", payload: result });
          return sendJson(response, 200, result);
        } catch (error) {
          if (error instanceof Error && error.message === "review-event-not-found") {
            return sendJson(response, 404, { error: "review-event-not-found" });
          }
          throw error;
        }
      }

      if (method === "GET" && url.pathname.startsWith("/integrations/archidekt/")) {
        const deckId = decodeURIComponent(url.pathname.slice("/integrations/archidekt/".length));
        const snapshot = await importDeck(deckId);
        return sendJson(response, 200, snapshot);
      }

      return sendJson(response, 404, { error: "not-found" });
    } catch (error) {
      if (error instanceof ZodError) {
        return sendJson(response, 400, { error: "invalid-request" });
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
          options.sqlite?.close();
          resolve();
        });
      }),
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function handleCorsPreflight(request: IncomingMessage, response: ServerResponse): void {
  if (!applyCorsHeaders(request, response)) {
    sendJson(response, 403, { error: "cors-origin-denied" });
    return;
  }
  response.statusCode = 204;
  response.end();
}

function applyCorsHeaders(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  const allowlist = (
    process.env.MANCUTG_CORS_ALLOWLIST ??
    "http://127.0.0.1:18080,http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!allowlist.includes(origin)) {
    return false;
  }

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
  return true;
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
