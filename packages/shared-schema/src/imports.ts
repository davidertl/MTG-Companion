import { z } from "zod";

export const platformTagSchema = z.enum(["desktop", "ios"]);
export const importSourceKindSchema = z.enum(["live-watch", "drag-and-drop", "folder-import"]);

export const offlineImportSummarySchema = z.object({
  platformTag: platformTagSchema,
  sourceKind: importSourceKindSchema,
  discoveredLogFiles: z.number().int().nonnegative(),
  importedSessions: z.number().int().nonnegative(),
  duplicateSessions: z.number().int().nonnegative(),
  insertedEvents: z.number().int().nonnegative(),
  parseWarnings: z.array(z.string()),
});

export type PlatformTag = z.infer<typeof platformTagSchema>;
export type ImportSourceKind = z.infer<typeof importSourceKindSchema>;
export type OfflineImportSummary = z.infer<typeof offlineImportSummarySchema>;
