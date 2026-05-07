/**
 * HTTP client for `mancutg-arenac serve` (loopback). Base URL must match the running service.
 * Default port is kept in sync with Rust `DEFAULT_LOOPBACK_PORT` (17890).
 */
export const DEFAULT_ARENAC_API_BASE = "http://127.0.0.1:17890";

export type ServiceStatus = {
  dataDir: string;
  logPath: string | null;
  storePath: string;
  settingsPath: string;
  defaultPlayerLogPath: string | null;
};

export type ArenaSettingsDto = {
  privacy: {
    telemetryEnabled: boolean;
    syncEnabled: boolean;
    allowedPurposes: string[];
  };
};

export type LocalStoreSummaryDto = {
  sessions: Array<{
    sessionId: string;
    platformTag: string;
    sourceKind: string;
    sourcePath: string;
  }>;
  matchHistory: Array<{
    matchId: string;
    deck: string;
    result: string | null;
    queue: string | null;
  }>;
  collectionSnapshot: { cardsOwned: number; capturedAt: string } | null;
  inventorySnapshot: {
    gold: number;
    gems: number;
    wildcards: number;
    vault: number;
    capturedAt: string;
  } | null;
  draftPicks: Array<{
    setCode: string;
    packNumber: number;
    pickNumber: number;
    choice: string;
    recordedAt: string;
  }>;
  unknownEvents: string[];
  diagnostics: Array<{
    sessionId: string;
    sourcePath: string;
    diagnosticKind: string;
    message: string;
  }>;
  checkpoints: Array<unknown>;
};

export type LiveWatchSummaryDto = {
  logPath: string;
  sessionId: string;
  insertedEvents: number;
  insertedRawChunks: number;
  parseWarnings: string[];
  unknownEvents: string[];
  rotationDetected: boolean;
  truncationDetected: boolean;
};

export type OfflineImportSummaryDto = {
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

export class ArenacApi {
  constructor(private readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: HeadersInit = {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    };
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/health");
  }

  detectPlayerLog(): Promise<{ playerLogPath: string | null }> {
    return this.request("/v1/detect-player-log");
  }

  status(): Promise<ServiceStatus> {
    return this.request("/v1/status");
  }

  configure(body: {
    logPath?: string;
    storePath?: string;
    settingsPath?: string;
  }): Promise<ServiceStatus> {
    return this.request("/v1/configure", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  watchTick(body?: { logPath?: string; storePath?: string }): Promise<LiveWatchSummaryDto> {
    return this.request("/v1/watch/tick", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  }

  storeSummary(): Promise<LocalStoreSummaryDto> {
    return this.request("/v1/store");
  }

  settings(): Promise<ArenaSettingsDto> {
    return this.request("/v1/settings");
  }

  setConsent(purpose: string, enabled: boolean): Promise<ArenaSettingsDto> {
    return this.request("/v1/settings/consent", {
      method: "POST",
      body: JSON.stringify({ purpose, enabled }),
    });
  }

  resetSettings(): Promise<ArenaSettingsDto> {
    return this.request("/v1/settings/reset", { method: "POST", body: "{}" });
  }

  importIosFile(logPath: string): Promise<OfflineImportSummaryDto> {
    return this.request("/v1/import/ios-file", {
      method: "POST",
      body: JSON.stringify({ logPath }),
    });
  }

  importIosFolder(directory: string): Promise<OfflineImportSummaryDto> {
    return this.request("/v1/import/ios-folder", {
      method: "POST",
      body: JSON.stringify({ directory }),
    });
  }

  /** Upload log text when the browser cannot expose a filesystem path to the service. */
  importLogText(fileName: string, content: string): Promise<OfflineImportSummaryDto> {
    return this.request("/v1/import/log-text", {
      method: "POST",
      body: JSON.stringify({ fileName, content }),
    });
  }

  exportBackup(): Promise<unknown> {
    return this.request("/v1/export-backup");
  }

  wipeLocalData(): Promise<{ removedStoreFile: boolean; removedSettingsFile: boolean }> {
    return this.request("/v1/wipe-local-data", { method: "POST", body: "{}" });
  }
}
