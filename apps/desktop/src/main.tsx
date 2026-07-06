import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArenaAppShell } from "./app/ArenaAppShell";
import { buildArenaAppShellState } from "./app/buildArenaAppShellState";
import type { ArenaAppShellInput } from "./app/buildArenaAppShellState";
import type { MatchHistoryRecord } from "./lib/query/history";
import type { CollectionSummary } from "./routes/collection/index";
import type { InventorySummary } from "./routes/inventory/index";
import type { DraftPickView } from "./routes/draft/index";
import type { ImportDiagnosticView } from "./routes/diagnostics/index";
import {
  buildMatchDetailState,
  type MatchDetailState,
} from "./routes/history/index";
import { saveBackupBundle } from "./lib/export/index";
import {
  tauriInspectStore,
  tauriShowSettings,
  tauriSetConsent,
  tauriWatchLog,
  tauriImportIosFile,
  tauriImportIosFolder,
  tauriExportBackup,
  tauriInspectMatch,
  tauriWriteExportFile,
  tauriStartWatcher,
  tauriStopWatcher,
  tauriWatcherStatus,
  type RustLocalStoreSummary,
  type RustArenaSettings,
  type RustWatcherStatus,
} from "./lib/tauri/commands";

function mapStoreToInput(
  store: RustLocalStoreSummary,
  settings: RustArenaSettings,
  watcher: RustWatcherStatus | null,
): ArenaAppShellInput {
  const matches: MatchHistoryRecord[] = store.matchHistory.map((m) => ({
    matchId: m.match_id,
    deck: m.deck,
    result: m.result === "win" || m.result === "loss" ? m.result : "unknown",
    queue: m.queue ?? "",
  }));

  const collection: CollectionSummary | undefined = store.collectionSnapshot
    ? {
        cardsOwned: store.collectionSnapshot.cards_owned,
        capturedAt: store.collectionSnapshot.captured_at,
      }
    : undefined;

  const inventory: InventorySummary | undefined = store.inventorySnapshot
    ? {
        gold: store.inventorySnapshot.gold,
        gems: store.inventorySnapshot.gems,
        wildcards: store.inventorySnapshot.wildcards,
        vault: store.inventorySnapshot.vault,
        capturedAt: store.inventorySnapshot.captured_at,
      }
    : undefined;

  const draftPicks: DraftPickView[] = store.draftPicks.map((p) => ({
    setCode: p.set_code,
    packNumber: p.pack_number,
    pickNumber: p.pick_number,
    choice: p.choice,
  }));

  const diagnostics: ImportDiagnosticView[] = store.diagnostics.map((d) => ({
    sessionId: d.sessionId,
    sourcePath: d.sourcePath,
    diagnosticKind: d.diagnosticKind,
    message: d.message,
  }));

  return {
    hasDetailedLogs: store.sessions.length > 0,
    logPath: watcher?.logPath ?? watcher?.defaultLogPath ?? undefined,
    watcherRunning: watcher?.running ?? false,
    privacy: {
      telemetryEnabled: settings.privacy.telemetryEnabled,
      syncEnabled: settings.privacy.syncEnabled,
      allowedPurposes: settings.privacy.allowedPurposes as (
        | "updates"
        | "sync"
        | "telemetry"
        | "archidekt"
      )[],
    },
    matches,
    collection,
    inventory,
    draftPicks,
    diagnostics,
    unknownEvents: store.unknownEvents,
  };
}

function App() {
  const [input, setInput] = useState<ArenaAppShellInput>({
    hasDetailedLogs: false,
  });
  const [watcher, setWatcher] = useState<RustWatcherStatus | null>(null);
  const [activeView, setActiveView] = useState<string>("Imports");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<MatchDetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [store, settings, status] = await Promise.all([
      tauriInspectStore(),
      tauriShowSettings(),
      tauriWatcherStatus().catch(() => null),
    ]);
    setWatcher(status);
    setInput(mapStoreToInput(store, settings, status));
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [refresh]);

  // Poll the live watcher status so the UI reflects real watcher state
  // (replacing the previously hardcoded `watcherRunning = false`).
  useEffect(() => {
    const interval = setInterval(() => {
      tauriWatcherStatus()
        .then((status) => {
          setWatcher(status);
          setInput((prev) => ({ ...prev, watcherRunning: status.running }));
        })
        .catch(() => {
          /* watcher status is best-effort; ignore transient failures */
        });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectMatch = useCallback(async (matchId: string) => {
    setSelectedMatchId(matchId);
    setDetailLoading(true);
    try {
      const inspection = await tauriInspectMatch(matchId);
      setMatchDetail(buildMatchDetailState(inspection.matchId, inspection.events));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMatchDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleToggleConsent = useCallback(
    async (purpose: string, enabled: boolean) => {
      try {
        await tauriSetConsent(purpose, enabled);
        await refresh();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const handleAction = useCallback(
    async (label: string) => {
      try {
        if (label === "Refresh local store") {
          await refresh();
        } else if (label === "Import iOS log file") {
          const selected = await open({
            filters: [{ name: "Log", extensions: ["log", "txt"] }],
          });
          if (selected && typeof selected === "string") {
            await tauriImportIosFile(selected);
            await refresh();
          }
        } else if (label === "Import iOS log folder") {
          const selected = await open({ directory: true });
          if (selected && typeof selected === "string") {
            await tauriImportIosFolder(selected);
            await refresh();
          }
        } else if (label === "Import desktop log") {
          const selected = await open({
            filters: [{ name: "Log", extensions: ["log", "txt"] }],
          });
          if (selected && typeof selected === "string") {
            await tauriWatchLog(selected);
            await refresh();
          }
        } else if (label === "Start live watcher") {
          // Prefer the OS default Arena log path; fall back to a picked file
          // when no default is known (e.g. Linux dev hosts).
          let logPath = watcher?.defaultLogPath ?? undefined;
          if (!logPath) {
            const selected = await open({
              filters: [{ name: "Log", extensions: ["log", "txt"] }],
            });
            logPath = selected && typeof selected === "string" ? selected : undefined;
            if (!logPath) {
              return;
            }
          }
          const status = await tauriStartWatcher(logPath);
          setWatcher(status);
          await refresh();
        } else if (label === "Stop live watcher") {
          const status = await tauriStopWatcher();
          setWatcher(status);
          await refresh();
        } else if (label === "Export backup bundle") {
          const bundle = await tauriExportBackup();
          await saveBackupBundle(bundle, {
            pickPath: (defaultName) =>
              save({
                defaultPath: defaultName,
                filters: [{ name: "JSON", extensions: ["json"] }],
              }),
            writeFile: tauriWriteExportFile,
          });
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, watcher],
  );

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0f17",
          color: "#dce6f4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          fontSize: 18,
        }}
      >
        Loading…
      </div>
    );
  }

  const state = buildArenaAppShellState(input);

  return (
    <>
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background: "#3a1a1a",
            border: "1px solid #7a2020",
            borderRadius: 12,
            padding: "12px 16px",
            color: "#ff8080",
            fontSize: 13,
            maxWidth: 400,
            zIndex: 9999,
            cursor: "pointer",
          }}
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}
      <ArenaAppShell
        state={state}
        activeView={activeView}
        onSelectView={setActiveView}
        onAction={handleAction}
        onToggleConsent={handleToggleConsent}
        history={{
          selectedMatchId,
          onSelectMatch: handleSelectMatch,
          detail: matchDetail,
          detailLoading,
        }}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
