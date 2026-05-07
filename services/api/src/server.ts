import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { ZodError } from "zod";

import { createInMemoryEventStore, type EventStore } from "./domain/eventService.ts";
import { createInMemorySyncStore, type SyncStore } from "./domain/syncService.ts";
import { mediaSessionsRoute } from "./routes/media/index.ts";
import { buildArchidektImportRoute, type ArchidektFetcher } from "./routes/integrations/archidekt/import.ts";
import { eventsRoute } from "./routes/events.ts";
import { syncRoute } from "./routes/sync.ts";

export interface ApiServerOptions {
  store?: SyncStore;
  eventStore?: EventStore;
  archidektFetcher?: ArchidektFetcher;
}

export interface StartedApiServer {
  server: Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

const defaultArchidektFetcher: ArchidektFetcher = async (deckId) => ({
  source: "archidekt",
  deckId,
  name: `Archidekt Deck ${deckId}`,
  updatedAt: new Date().toISOString(),
  cards: [],
});

export function createApiServer(options: ApiServerOptions = {}): Server {
  const store = options.store ?? createInMemorySyncStore();
  const eventStore = options.eventStore ?? createInMemoryEventStore();
  const importDeck = buildArchidektImportRoute(options.archidektFetcher ?? defaultArchidektFetcher);

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

      return sendJson(response, 404, { error: "not-found" });
    } catch (error) {
      if (error instanceof ZodError) {
        return sendJson(response, 400, { error: "invalid-request" });
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
