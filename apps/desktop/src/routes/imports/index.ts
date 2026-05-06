import type { PlatformTag } from "../../../../../packages/shared-schema/src/imports";
import {
  getIosOfflineImportGuidance,
  getIosOfflineImportMethods,
} from "../setup/index";

export interface ImportCenterSummary {
  platformTag: PlatformTag;
  sourceKind: "drag-and-drop" | "folder-import" | "live-watch";
  discoveredLogFiles: number;
  importedSessions: number;
  duplicateSessions: number;
  insertedRawChunks: number;
  insertedEvents: number;
  importedPaths: string[];
  parseWarnings: string[];
}

export interface ImportCenterState {
  title: string;
  empty: boolean;
  supportsDesktopLogs: boolean;
  supportsIosOfflineImport: boolean;
  availableMethods: ReturnType<typeof getIosOfflineImportMethods>;
  iosMethods: ReturnType<typeof getIosOfflineImportMethods>;
  iosGuidance: ReturnType<typeof getIosOfflineImportGuidance>;
  lastImportSummary: ImportCenterSummary | null;
  lastImport: ImportCenterSummary | null;
  summary: string | null;
}

export interface ImportCenterOptions {
  lastImportSummary?: ImportCenterSummary;
}

export function buildImportCenterState(
  options: ImportCenterOptions = {},
): ImportCenterState {
  const lastImport = options.lastImportSummary ?? null;
  const summary = lastImport
    ? `${lastImport.importedSessions} neue Session${lastImport.importedSessions === 1 ? "" : "s"}, ${lastImport.duplicateSessions} Duplikat${lastImport.duplicateSessions === 1 ? "" : "e"}`
    : null;
  const iosMethods = getIosOfflineImportMethods();

  return {
    title: "Import Center",
    empty: !lastImport,
    supportsDesktopLogs: true,
    supportsIosOfflineImport: true,
    availableMethods: iosMethods,
    iosMethods,
    iosGuidance: getIosOfflineImportGuidance("other"),
    lastImportSummary: lastImport,
    lastImport,
    summary,
  };
}
