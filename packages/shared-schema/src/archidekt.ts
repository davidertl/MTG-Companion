import { z } from "zod";

export const archidektCardSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  category: z.string().min(1),
});

export const archidektDeckSnapshotSchema = z.object({
  source: z.literal("archidekt"),
  deckId: z.string().min(1),
  name: z.string().min(1),
  updatedAt: z.string().min(1),
  cards: z.array(archidektCardSchema),
});

export type ArchidektDeckSnapshot = z.infer<typeof archidektDeckSnapshotSchema>;
