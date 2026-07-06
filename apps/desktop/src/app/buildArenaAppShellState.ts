import {
  buildCollectionRouteState,
  buildDecksRouteState,
  buildDiagnosticsRouteState,
  buildDraftRouteState,
  buildHistoryRouteState,
  buildImportCenterState,
  buildInventoryRouteState,
  buildPrivacyRouteState,
  buildSettingsState,
  getSetupBanner,
  getSetupChecklist,
} from "../index";
import type { DeckSnapshot, PrivacySettings } from "../../../../packages/shared-schema/src/index";
import { createPrivacySettings } from "../lib/network/privacy";
import type { ImportCenterSummary } from "../routes/imports/index";
import type { MatchHistoryRecord } from "../lib/query/history";
import type { CollectionSummary } from "../routes/collection/index";
import type { InventorySummary } from "../routes/inventory/index";
import type { DraftPickView } from "../routes/draft/index";
import type { ImportDiagnosticView } from "../routes/diagnostics/index";
import type { RustCardDbStatus } from "../lib/tauri/commands";

export type ArenaShellActions = {
  startWatcherLabel: string;
  stopWatcherLabel: string;
  importLocalLabel: string;
  importIosFileLabel: string;
  importIosFolderLabel: string;
  exportBackupLabel: string;
  refreshLabel: string;
};

export type ArenaAppShellInput = {
  hasDetailedLogs: boolean;
  logPath?: string;
  watcherRunning?: boolean;
  privacy?: Partial<PrivacySettings>;
  importSummary?: ImportCenterSummary;
  matches?: MatchHistoryRecord[];
  collection?: CollectionSummary;
  inventory?: InventorySummary;
  draftPicks?: DraftPickView[];
  decks?: DeckSnapshot[];
  diagnostics?: ImportDiagnosticView[];
  unknownEvents?: string[];
  /** Local analysis toggle (offline feature, persisted client-side). */
  analysisEnabled?: boolean;
  /** Card DB status for the Settings display + analysis empty state. */
  cardDb?: Pick<RustCardDbStatus, "cardDbExists" | "cardCount" | "withArenaIdCount"> | null;
};

export function buildArenaAppShellState(input: ArenaAppShellInput) {
  const privacy = createPrivacySettings(input.privacy);
  const setupChecklist = getSetupChecklist({
    hasDetailedLogs: input.hasDetailedLogs,
    logPath: input.logPath,
  });
  const setupBanner = getSetupBanner({
    hasDetailedLogs: input.hasDetailedLogs,
    logPath: input.logPath,
  });

  return {
    title: "MancuTG-ArenaC",
    subtitle: "Offline-first Arena companion for logs, imports, and local insights.",
    watcherRunning: input.watcherRunning ?? false,
    actions: {
      startWatcherLabel: "Start live watcher",
      stopWatcherLabel: "Stop live watcher",
      importLocalLabel: "Import desktop log",
      importIosFileLabel: "Import iOS log file",
      importIosFolderLabel: "Import iOS log folder",
      exportBackupLabel: "Export backup bundle",
      refreshLabel: "Refresh local store",
    } satisfies ArenaShellActions,
    nav: [
      "Setup",
      "Imports",
      "Match History",
      "Collection",
      "Inventory",
      "Draft",
      "Decks",
      "Diagnostics",
      "Privacy",
      "Settings",
    ],
    setup: {
      banner: setupBanner,
      checklist: setupChecklist,
    },
    imports: buildImportCenterState({
      lastImportSummary: input.importSummary,
    }),
    history: buildHistoryRouteState(input.matches ?? []),
    collection: buildCollectionRouteState(input.collection),
    inventory: buildInventoryRouteState(input.inventory),
    draft: buildDraftRouteState(input.draftPicks ?? []),
    decks: buildDecksRouteState(input.decks ?? [], {
      archidektEnabled: privacy.allowedPurposes.includes("archidekt"),
    }),
    diagnostics: buildDiagnosticsRouteState(
      input.diagnostics ?? [],
      input.unknownEvents ?? [],
    ),
    privacy: buildPrivacyRouteState(privacy),
    settings: buildSettingsState(privacy, {
      analysisEnabled: input.analysisEnabled,
      cardDb: input.cardDb,
    }),
  };
}

export type ArenaAppShellState = ReturnType<typeof buildArenaAppShellState>;
