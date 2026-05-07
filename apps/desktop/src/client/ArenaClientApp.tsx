import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { ArenaAppShell } from "../app/ArenaAppShell";
import { buildArenaAppShellState } from "../app/buildArenaAppShellState";
import {
  ArenacApi,
  DEFAULT_ARENAC_API_BASE,
  type LocalStoreSummaryDto,
  type ArenaSettingsDto,
  type ServiceStatus,
} from "../lib/api/client";
import { mapToArenaAppShellInput } from "../lib/api/mapStoreToShell";
import type { ImportCenterSummary } from "../routes/imports/index";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const pillButton: CSSProperties = {
  border: "1px solid #35507a",
  borderRadius: 999,
  background: "#192334",
  color: "#f7f9fc",
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryButton: CSSProperties = {
  ...pillButton,
  background: "#4f8cff",
};

export function ArenaClientApp(props: { defaultBaseUrl?: string }) {
  const baseUrl = props.defaultBaseUrl ?? DEFAULT_ARENAC_API_BASE;
  const apiRef = useRef(new ArenacApi(baseUrl));
  const [serviceUrl, setServiceUrl] = useState(baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [watcherRunning, setWatcherRunning] = useState(false);
  const [lastImport, setLastImport] = useState<ImportCenterSummary | null>(null);
  const [shell, setShell] = useState(() =>
    buildArenaAppShellState({ hasDetailedLogs: false, watcherRunning: false }),
  );

  const loadAllRef = useRef<() => Promise<void>>(async () => {});

  loadAllRef.current = async () => {
    try {
      setError(null);
      const api = apiRef.current;
      const [store, settings, status]: [
        LocalStoreSummaryDto,
        ArenaSettingsDto,
        ServiceStatus,
      ] = await Promise.all([api.storeSummary(), api.settings(), api.status()]);
      setShell(
        buildArenaAppShellState(
          mapToArenaAppShellInput({
            store,
            settings,
            service: status,
            watcherRunning,
            lastImportSummary: lastImport,
          }),
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    apiRef.current = new ArenacApi(serviceUrl);
  }, [serviceUrl]);

  useEffect(() => {
    void loadAllRef.current();
  }, [watcherRunning, lastImport, serviceUrl]);

  useEffect(() => {
    if (!watcherRunning) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          await apiRef.current.watchTick();
          await loadAllRef.current();
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, 2000);
    return () => window.clearInterval(id);
  }, [watcherRunning]);

  const fileRef = useRef<HTMLInputElement>(null);

  const toolbar = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ color: "#b6c5da", fontSize: 13 }}>
        Companion service URL{" "}
        <input
          value={serviceUrl}
          onChange={(event) => setServiceUrl(event.target.value)}
          style={{
            marginLeft: 8,
            minWidth: 280,
            background: "#0d121b",
            border: "1px solid #24324a",
            color: "#f7f9fc",
            borderRadius: 8,
            padding: "6px 10px",
          }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          style={watcherRunning ? pillButton : primaryButton}
          onClick={() => setWatcherRunning((running) => !running)}
        >
          {watcherRunning ? "Stop live watcher" : "Start live watcher"}
        </button>
        <button type="button" style={pillButton} onClick={() => void loadAllRef.current()}>
          Refresh store
        </button>
        <button
          type="button"
          style={pillButton}
          onClick={async () => {
            try {
              const { playerLogPath } = await apiRef.current.detectPlayerLog();
              if (playerLogPath) {
                await apiRef.current.configure({ logPath: playerLogPath });
                await loadAllRef.current();
              } else {
                setError("Could not detect Player.log on this system.");
              }
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Use detected Player.log
        </button>
        <button
          type="button"
          style={pillButton}
          onClick={async () => {
            try {
              const data = await apiRef.current.exportBackup();
              downloadJson("mancutg-arenac-backup.json", data);
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Export backup JSON
        </button>
        <button
          type="button"
          style={pillButton}
          onClick={() => fileRef.current?.click()}
        >
          Import iOS .log file
        </button>
        <button
          type="button"
          style={pillButton}
          onClick={() => {
            const directory = window.prompt(
              "Folder path on this PC containing exported .log files (server-side path)",
            );
            if (!directory?.trim()) return;
            void (async () => {
              try {
                const summary = await apiRef.current.importIosFolder(directory.trim());
                setLastImport({
                  platformTag: summary.platformTag === "ios" ? "ios" : "desktop",
                  sourceKind: summary.sourceKind as ImportCenterSummary["sourceKind"],
                  discoveredLogFiles: summary.discoveredLogFiles,
                  importedSessions: summary.importedSessions,
                  duplicateSessions: summary.duplicateSessions,
                  insertedRawChunks: summary.insertedRawChunks,
                  insertedEvents: summary.insertedEvents,
                  importedPaths: summary.importedPaths,
                  parseWarnings: summary.parseWarnings,
                });
                await loadAllRef.current();
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        >
          Import iOS folder (path)
        </button>
        <button
          type="button"
          style={pillButton}
          onClick={async () => {
            if (!window.confirm("Wipe local SQLite store and settings for this data directory?")) return;
            try {
              await apiRef.current.wipeLocalData();
              setLastImport(null);
              await loadAllRef.current();
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Wipe local data
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={{ color: "#8ea0bc", fontSize: 13, marginRight: 8 }}>Consent:</span>
        {(["telemetry", "sync", "archidekt"] as const).map((purpose) => (
          <button
            key={purpose}
            type="button"
            style={pillButton}
            onClick={async () => {
              try {
                const s = await apiRef.current.settings();
                const enabled =
                  purpose === "telemetry"
                    ? !s.privacy.telemetryEnabled
                    : purpose === "sync"
                      ? !s.privacy.syncEnabled
                      : !s.privacy.allowedPurposes.includes("archidekt");
                await apiRef.current.setConsent(purpose, enabled);
                await loadAllRef.current();
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Toggle {purpose}
          </button>
        ))}
        <button
          type="button"
          style={pillButton}
          onClick={async () => {
            try {
              await apiRef.current.resetSettings();
              await loadAllRef.current();
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Reset settings
        </button>
      </div>
      <input
        type="file"
        ref={fileRef}
        style={{ display: "none" }}
        accept=".log,text/plain"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const content = await file.text();
            const summary = await apiRef.current.importLogText(file.name, content);
            setLastImport({
              platformTag: summary.platformTag === "ios" ? "ios" : "desktop",
              sourceKind: summary.sourceKind as ImportCenterSummary["sourceKind"],
              discoveredLogFiles: summary.discoveredLogFiles,
              importedSessions: summary.importedSessions,
              duplicateSessions: summary.duplicateSessions,
              insertedRawChunks: summary.insertedRawChunks,
              insertedEvents: summary.insertedEvents,
              importedPaths: summary.importedPaths,
              parseWarnings: summary.parseWarnings,
            });
            await loadAllRef.current();
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </div>
  );

  return (
    <div>
      {error ? (
        <div
          style={{
            margin: 16,
            padding: 12,
            borderRadius: 12,
            background: "#3d1f24",
            border: "1px solid #8b3d45",
            color: "#f7d0d4",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : null}
      <ArenaAppShell state={shell} toolbarSlot={toolbar} />
    </div>
  );
}
