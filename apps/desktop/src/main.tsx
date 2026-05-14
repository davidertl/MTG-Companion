import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { open } from "@tauri-apps/plugin-dialog";
import { ArenaAppShell } from "./app/ArenaAppShell";
import { buildArenaAppShellState } from "./app/buildArenaAppShellState";
import type { ArenaAppShellInput } from "./app/buildArenaAppShellState";
import type { MatchHistoryRecord } from "./lib/query/history";
import type { CollectionSummary } from "./routes/collection/index";
import type { InventorySummary } from "./routes/inventory/index";
import type { DraftPickView } from "./routes/draft/index";
import type { ImportDiagnosticView } from "./routes/diagnostics/index";
import {
  tauriInspectStore,
  tauriShowSettings,
  tauriWatchLog,
  tauriImportIosFile,
  tauriImportIosFolder,
  tauriExportBackup,
  type RustLocalStoreSummary,
  type RustArenaSettings,
} from "./lib/tauri/commands";

function mapStoreToInput(
  store: RustLocalStoreSummary,
  settings: RustArenaSettings,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [store, settings] = await Promise.all([
      tauriInspectStore(),
      tauriShowSettings(),
    ]);
    setInput(mapStoreToInput(store, settings));
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [refresh]);

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
        } else if (
          label === "Import desktop log" ||
          label === "Start live watcher"
        ) {
          const selected = await open({
            filters: [{ name: "Log", extensions: ["log", "txt"] }],
          });
          if (selected && typeof selected === "string") {
            await tauriWatchLog(selected);
            await refresh();
          }
        } else if (label === "Export backup bundle") {
          await tauriExportBackup();
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
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
      <ArenaAppShell state={state} onAction={handleAction} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
