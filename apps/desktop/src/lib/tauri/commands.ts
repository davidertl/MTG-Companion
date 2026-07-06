import { invoke } from "@tauri-apps/api/core";

// Raw types from Rust — core-domain structs have no rename_all, so fields are snake_case.
// Wrapper structs in lib.rs use rename_all = "camelCase" for their own fields.

export type RustMatchRecord = {
  match_id: string;
  deck: string;
  result: string | null;
  queue: string | null;
};

export type RustCollectionSnapshot = {
  cards_owned: number;
  captured_at: string;
};

export type RustInventorySnapshot = {
  gold: number;
  gems: number;
  wildcards: number;
  vault: number;
  captured_at: string;
};

export type RustDraftPick = {
  set_code: string;
  pack_number: number;
  pick_number: number;
  choice: string;
  recorded_at: string;
};

export type RustImportedSessionSummary = {
  sessionId: string;
  platformTag: string;
  sourceKind: string;
  sourcePath: string;
};

export type RustImportDiagnosticSummary = {
  sessionId: string;
  sourcePath: string;
  diagnosticKind: string;
  message: string;
};

export type RustLocalStoreSummary = {
  sessions: RustImportedSessionSummary[];
  matchHistory: RustMatchRecord[];
  collectionSnapshot: RustCollectionSnapshot | null;
  inventorySnapshot: RustInventorySnapshot | null;
  draftPicks: RustDraftPick[];
  unknownEvents: string[];
  diagnostics: RustImportDiagnosticSummary[];
};

export type RustArenaPrivacy = {
  telemetryEnabled: boolean;
  syncEnabled: boolean;
  allowedPurposes: string[];
};

export type RustArenaSettings = {
  privacy: RustArenaPrivacy;
};

export type RustOfflineLogImportSummary = {
  platformTag: string;
  sourceKind: string;
  discoveredLogFiles: number;
  importedSessions: number;
  duplicateSessions: number;
  insertedRawChunks: number;
  insertedEvents: number;
  importedPaths: string[];
  parseWarnings: string[];
};

export type RustLiveLogWatchSummary = {
  logPath: string;
  sessionId: string;
  insertedEvents: number;
  insertedRawChunks: number;
  parseWarnings: string[];
  unknownEvents: string[];
};

export type RustBackupBundle = {
  sessions: RustImportedSessionSummary[];
  matchHistory: RustMatchRecord[];
  collectionSnapshot: RustCollectionSnapshot | null;
  inventorySnapshot: RustInventorySnapshot | null;
  draftPicks: RustDraftPick[];
  unknownEvents: string[];
  diagnostics: RustImportDiagnosticSummary[];
};

export const tauriInspectStore = () =>
  invoke<RustLocalStoreSummary>("inspect_store");

export const tauriShowSettings = () =>
  invoke<RustArenaSettings>("show_settings");

export const tauriSetConsent = (purpose: string, enabled: boolean) =>
  invoke<RustArenaSettings>("set_consent", { purpose, enabled });

export const tauriWatchLog = (logPath: string) =>
  invoke<RustLiveLogWatchSummary>("watch_log", { logPath });

export const tauriImportIosFile = (logPath: string) =>
  invoke<RustOfflineLogImportSummary>("import_ios_file", { logPath });

export const tauriImportIosFolder = (directory: string) =>
  invoke<RustOfflineLogImportSummary>("import_ios_folder", { directory });

export const tauriExportBackup = () =>
  invoke<RustBackupBundle>("export_backup");

export type RustMatchEventSummary = {
  sessionId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  payloadJson: string;
};

export type RustMatchInspection = {
  matchId: string;
  events: RustMatchEventSummary[];
};

export const tauriInspectMatch = (matchId: string) =>
  invoke<RustMatchInspection>("inspect_match", { matchId });

// Reconstructed per-turn game timeline (core-gamestate). Zone/action shapes are
// intentionally loose here — the desktop timeline view treats them structurally;
// core-domain field casing (snake_case) is preserved verbatim.
export type RustCardRef = {
  name?: string;
  arenaId?: number;
  scryfallOracleId?: string;
};

export type RustObjectState = {
  instanceId?: number;
  cardRef: RustCardRef;
  controller?: string;
  tapped: boolean;
  counters?: Record<string, number>;
};

export type RustPlayerZones = {
  battlefield: RustObjectState[];
  graveyard: RustObjectState[];
  exile: RustObjectState[];
  handCount: number;
  libraryCount: number;
};

export type RustTimelineAction =
  | { source: "parsed"; [key: string]: unknown }
  | {
      source: "raw";
      eventType: string;
      sequence: number;
      payload: unknown;
      note: string;
    };

export type RustTurnSnapshot = {
  turnNumber: number;
  activePlayer?: string;
  phase?: string;
  step?: string;
  zones: Record<string, RustPlayerZones>;
  lifeTotals: Record<string, number>;
  actions: RustTimelineAction[];
};

export type RustCompleteness =
  | { kind: "complete" }
  | { kind: "partial"; reason: string };

export type RustGameTimeline = {
  turns: RustTurnSnapshot[];
  completeness: RustCompleteness;
  notes: string[];
};

export type RustMatchTimeline = {
  matchId: string;
  timeline: RustGameTimeline;
};

export const tauriLoadGameTimeline = (matchId: string) =>
  invoke<RustMatchTimeline>("load_game_timeline", { matchId });

export const tauriWriteExportFile = (path: string, contents: string) =>
  invoke<string>("write_export_file", { path, contents });

export type RustWatcherStatus = {
  running: boolean;
  logPath: string | null;
  defaultLogPath: string | null;
  ingestCount: number;
  totalInsertedEvents: number;
  totalInsertedRawChunks: number;
  lastError: string | null;
};

export const tauriStartWatcher = (logPath?: string) =>
  invoke<RustWatcherStatus>("start_watcher", { logPath: logPath ?? null });

export const tauriStopWatcher = () =>
  invoke<RustWatcherStatus>("stop_watcher");

export const tauriWatcherStatus = () =>
  invoke<RustWatcherStatus>("watcher_status");
