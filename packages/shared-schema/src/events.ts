import { z } from "zod";

export const eventSourceAppSchema = z.enum(["mancutg-arenac", "mancutg-paperc"]);

export const backendEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  sourceApp: eventSourceAppSchema,
  eventType: z.string().min(1),
  occurredAt: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const backendEventBatchSchema = z.array(backendEventEnvelopeSchema).min(1);

export type EventSourceApp = z.infer<typeof eventSourceAppSchema>;
export type BackendEventEnvelope = z.infer<typeof backendEventEnvelopeSchema>;
