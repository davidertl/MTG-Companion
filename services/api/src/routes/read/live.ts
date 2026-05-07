import type { ServerResponse } from "node:http";

export type LiveMessage =
  | { type: "ingest.accepted"; payload: Record<string, unknown> }
  | { type: "review.resolved"; payload: Record<string, unknown> };

export interface LiveHub {
  publish: (message: LiveMessage) => void;
  subscribe: (response: ServerResponse) => () => void;
}

export function createLiveHub(): LiveHub {
  const clients = new Set<ServerResponse>();

  return {
    publish: (message) => {
      const frame = `data: ${JSON.stringify(message)}\n\n`;
      for (const client of clients) {
        client.write(frame);
      }
    },
    subscribe: (response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache");
      response.setHeader("connection", "keep-alive");
      response.write("event: ready\ndata: {}\n\n");
      clients.add(response);
      return () => {
        clients.delete(response);
      };
    },
  };
}
