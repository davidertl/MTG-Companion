import { z } from "zod";

export const deckCardSchema = z.object({
  name: z.string(),
  quantity: z.number().int().positive(),
  category: z.string().default("mainboard"),
});

export const deckSnapshotSchema = z.object({
  source: z.enum(["local", "archidekt"]),
  deckId: z.string(),
  name: z.string(),
  updatedAt: z.string(),
  cards: z.array(deckCardSchema),
});

export const syncObjectSchema = z.object({
  objectType: z.string(),
  objectId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  dirty: z.boolean(),
  lastError: z.string().nullable(),
});

export const telemetryEventSchema = z.object({
  name: z.string(),
  properties: z.record(z.string(), z.string()),
});

export type DeckCard = z.infer<typeof deckCardSchema>;
export type DeckSnapshot = z.infer<typeof deckSnapshotSchema>;
export type SyncObject = z.infer<typeof syncObjectSchema>;
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export * from "./events";
export * from "./imports";
export * from "./media";
export * from "./paperc";
export * from "./privacy";
export * from "./tournaments";
