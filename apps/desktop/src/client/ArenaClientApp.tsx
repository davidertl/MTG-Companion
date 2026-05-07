import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { ArenaSideNav } from "../app/ArenaSideNav";
import { findRoute, type ArenaRouteId } from "../app/routes";
import { MatchHistoryPanel } from "../components/route-panels";
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

const errorBox: CSSProperties = {
  margin: 16,
  padding: 12,
  borderRadius: 12,
  background: "#3d1f24",
  border: "1px solid #8b3d45",
  color: "#f7d0d4",
  fontSize: 14,
};

export function ArenaClientApp(props: {
  defaultBaseUrl?: string;
  /**
   * Bridges side-nav clicks to the host (Overwolf, browser dev, ...).
   * Receives the manifest window name (e.g. "imports", "setup") and an error reporter.
   * When unset, side-nav clicks are silently ignored.
   */
  navigateBridge?: (windowName: string, reportError: (message: string) => void) => void;
}) {
  const { navigateBridge } = props;
  const baseUrl = props.defaultBaseUrl ?? DEFAULT_ARENAC_API_BASE;
  const apiRef = useRef(new ArenacApi(baseUrl));
  const [serviceUrl, setServiceUrl] = useState(baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [watcherRunning, setWatcherRunning] = useState(false);
  const watcherRunningRef = useRef(watcherRunning);
  watcherRunningRef.current = watcherRunning;

  const [resolvedLogPath, setResolvedLogPath] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<ImportCenterSummary | null>(null);
  const [shell, setShell] = useState(() =>
    buildArenaAppShellState({
      hasDetailedLogs: false,
      detailedLogsAcknowledged: false,
      watcherRunning: false,
    }),
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
      const logPath = status.logPath ?? status.defaultPlayerLogPath ?? null;
      setResolvedLogPath(logPath);
      setShell(
        buildArenaAppShellState(
          mapToArenaAppShellInput({
            store,
            settings,
            service: status,
            watcherRunning: watcherRunningRef.current,
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
    let cancelled = false;
    void (async () => {
      try {
        const api = apiRef.current;
        const health = await api.health();
        if (!health.ok || cancelled) return;
        const status = await api.status();
        if (cancelled) return;
        let path = status.logPath ?? status.defaultPlayerLogPath ?? null;
        if (!path) {
          const detected = await api.detectPlayerLog();
          if (cancelled) return;
          if (detected.playerLogPath) {
            await api.configure({ logPath: detected.playerLogPath });
            path = detected.playerLogPath;
          }
        } else if (!status.logPath && status.defaultPlayerLogPath) {
          await api.configure({ logPath: status.defaultPlayerLogPath });
          path = status.defaultPlayerLogPath;
        }
        if (cancelled) return;
        setResolvedLogPath(path);
        if (path) {
          setWatcherRunning(true);
        }
      } catch {
        /* sidecar not running — watcher stays off */
      }
    })();
    return () => {
      cancelled = true;
    };
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

  function handleNavigate(routeId: ArenaRouteId): void {
    if (routeId === "match-history") return;
    const target = findRoute(routeId);
    if (!navigateBridge) return;
    navigateBridge(target.overwolfWindow, (msg) => setError(msg));
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0f17",
        color: "#dce6f4",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "grid",
          gap: 16,
        }}
      >
        <header style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              color: "#9ec5ff",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            MancuTG-ArenaC
          </span>
          <h1 style={{ margin: 0, color: "#f7f9fc", fontSize: 28 }}>{shell.title}</h1>
          <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>{shell.subtitle}</p>
        </header>
        {error ? <div style={errorBox}>{error}</div> : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: 20,
          }}
        >
          <ArenaSideNav active="match-history" onNavigate={handleNavigate} />
          <section style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                display: "grid",
                gap: 12,
                padding: 20,
                background: "#0f1520",
                border: "1px solid #24324a",
                borderRadius: 18,
              }}
            >
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
              <div
                style={{
                  fontSize: 13,
                  color: "#8ea0bc",
                  lineHeight: 1.45,
                  wordBreak: "break-word",
                }}
              >
                <strong style={{ color: "#b6c5da" }}>Player.log (resolved):</strong>{" "}
                {resolvedLogPath ?? "— start the sidecar or open the connection wizard"}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  style={watcherRunning ? pillButton : primaryButton}
                  onClick={() => setWatcherRunning((running) => !running)}
                >
                  {watcherRunning ? "Stop live watcher" : "Start live watcher"}
                </button>
                <button
                  type="button"
                  style={pillButton}
                  onClick={() => void loadAllRef.current()}
                >
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
            <MatchHistoryPanel state={shell.history} variant="detail" />
          </section>
        </div>
      </div>
    </main>
  );
}
