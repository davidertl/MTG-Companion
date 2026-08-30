import { z } from "zod";

import {
  analysisEventTypeSchema,
  type BackendEventEnvelope,
} from "../../../../packages/shared-schema/src/index.ts";
import { resolveStore, type BackendStoreLike } from "../domain/eventService.ts";

/**
 * Analysis findings/suggestions/reviews carry an `audience` and are subject to
 * referee-only visibility rules. This anonymous pull endpoint cannot enforce
 * those rules (it has no authenticated caller or role), so `analysis.*` events
 * are never returned here — they are readable only through the role-gated
 * `GET /tournaments/:id/findings`. Offline sync never needs to *pull* findings,
 * so excluding them does not affect the sync contract.
 */
function isVisibilityRestrictedEventType(eventType: string): boolean {
  return analysisEventTypeSchema.safeParse(eventType).success;
}

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
 *
 * Audience-restricted `analysis.*` events are filtered out of this feed (see
 * {@link isVisibilityRestrictedEventType}); the cursor still advances past them
 * so paging stays gap-free.
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
    events: page
      .map((entry) => entry.event)
      .filter((event) => !isVisibilityRestrictedEventType(event.eventType)),
    nextCursor,
  };
}
