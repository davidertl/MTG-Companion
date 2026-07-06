import { z } from "zod";

import type { BackendEventEnvelope } from "../../../../packages/shared-schema/src/index.ts";
import { resolveStore, type BackendStoreLike } from "../domain/eventService.ts";

export const eventsPullQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(100),
  tournamentId: z.string().min(1).optional(),
});

export type EventsPullQuery = z.input<typeof eventsPullQuerySchema>;

export interface EventsPullRouteResult {
  events: BackendEventEnvelope[];
  nextCursor: number;
}

/**
 * Cursor-based pull sync: `GET /events?cursor=<n>&limit=<m>[&tournamentId=...]`.
 *
 * Events are returned in stable append order (per-insert monotonic cursor).
 * Clients page by passing the returned `nextCursor` back; because the cursor
 * is assigned at insert time and events are append-only, paging yields no
 * gaps and no duplicates. An empty page returns the requested cursor
 * unchanged, so polling clients can simply retry with the same value.
 */
export function eventsPullRoute(
  query: unknown,
  storeLike: BackendStoreLike,
): EventsPullRouteResult {
  const { cursor, limit, tournamentId } = eventsPullQuerySchema.parse(query ?? {});
  const store = resolveStore(storeLike);

  const page = store.readEventsAfter(cursor, limit, tournamentId);
  const nextCursor = page.length > 0 ? page[page.length - 1].cursor : cursor;

  return {
    events: page.map((entry) => entry.event),
    nextCursor,
  };
}
