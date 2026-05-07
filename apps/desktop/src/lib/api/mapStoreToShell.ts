import type { ArenaAppShellInput } from "../../app/buildArenaAppShellState";
import type { ImportCenterSummary } from "../../routes/imports/index";
import type { MatchHistoryRecord } from "../query/history";
import type { CollectionSummary } from "../../routes/collection/index";
import type { InventorySummary } from "../../routes/inventory/index";
import type { DraftPickView } from "../../routes/draft/index";
import type { ImportDiagnosticView } from "../../routes/diagnostics/index";
import { createPrivacySettings } from "../network/privacy";
import type { NetworkPurpose } from "../network/privacy";
import type { ArenaSettingsDto, LocalStoreSummaryDto, OfflineImportSummaryDto } from "./client";

const PURPOSES = new Set<NetworkPurpose>(["updates", "sync", "telemetry", "archidekt"]);

function sanitizePurposes(raw: string[]): NetworkPurpose[] {
  return raw.filter((p): p is NetworkPurpose => PURPOSES.has(p as NetworkPurpose));
}

function mapMatch(record: LocalStoreSummaryDto["matchHistory"][0]): MatchHistoryRecord {
  const r = record.result?.toLowerCase() ?? "";
  let result: MatchHistoryRecord["result"] = "unknown";
  if (r.includes("win")) result = "win";
  else if (r.includes("loss")) result = "loss";
  return {
    matchId: record.matchId,
    deck: record.deck,
    result,
    queue: record.queue ?? "unknown",
  };
}

function mapImportSummary(summary: OfflineImportSummaryDto): ImportCenterSummary {
  const sourceKind = summary.sourceKind as ImportCenterSummary["sourceKind"];
  const platformTag = (summary.platformTag === "ios" ? "ios" : "desktop") as ImportCenterSummary["platformTag"];
  return {
    platformTag,
    sourceKind,
    discoveredLogFiles: summary.discoveredLogFiles,
    importedSessions: summary.importedSessions,
    duplicateSessions: summary.duplicateSessions,
    insertedRawChunks: summary.insertedRawChunks,
    insertedEvents: summary.insertedEvents,
    importedPaths: summary.importedPaths,
    parseWarnings: summary.parseWarnings,
  };
}

function mapCollection(snapshot: LocalStoreSummaryDto["collectionSnapshot"]): CollectionSummary | undefined {
  if (!snapshot) return undefined;
  return {
    cardsOwned: snapshot.cardsOwned,
    capturedAt: snapshot.capturedAt,
  };
}

function mapInventory(snapshot: LocalStoreSummaryDto["inventorySnapshot"]): InventorySummary | undefined {
  if (!snapshot) return undefined;
  return {
    gold: snapshot.gold,
    gems: snapshot.gems,
    wildcards: snapshot.wildcards,
    vault: snapshot.vault,
    capturedAt: snapshot.capturedAt,
  };
}

function mapDraftPicks(picks: LocalStoreSummaryDto["draftPicks"]): DraftPickView[] {
  return picks.map((p) => ({
    setCode: p.setCode,
    packNumber: p.packNumber,
    pickNumber: p.pickNumber,
    choice: p.choice,
  }));
}

function mapDiagnostics(rows: LocalStoreSummaryDto["diagnostics"]): ImportDiagnosticView[] {
  return rows.map((d) => ({
    sessionId: d.sessionId,
    sourcePath: d.sourcePath,
    diagnosticKind: d.diagnosticKind,
    message: d.message,
  }));
}

export function mapToArenaAppShellInput(params: {
  store: LocalStoreSummaryDto;
  settings: ArenaSettingsDto;
  service: { logPath: string | null; defaultPlayerLogPath: string | null };
  watcherRunning: boolean;
  lastImportSummary: ImportCenterSummary | null;
}): ArenaAppShellInput {
  const logPath = params.service.logPath ?? params.service.defaultPlayerLogPath ?? undefined;
  const privacy = createPrivacySettings({
    telemetryEnabled: params.settings.privacy.telemetryEnabled,
    syncEnabled: params.settings.privacy.syncEnabled,
    allowedPurposes: sanitizePurposes(params.settings.privacy.allowedPurposes),
  });

  return {
    hasDetailedLogs: Boolean(logPath),
    logPath,
    watcherRunning: params.watcherRunning,
    privacy,
    importSummary: params.lastImportSummary ?? undefined,
    matches: params.store.matchHistory.map(mapMatch),
    collection: mapCollection(params.store.collectionSnapshot),
    inventory: mapInventory(params.store.inventorySnapshot),
    draftPicks: mapDraftPicks(params.store.draftPicks),
    diagnostics: mapDiagnostics(params.store.diagnostics),
    unknownEvents: params.store.unknownEvents,
    decks: [],
  };
}
