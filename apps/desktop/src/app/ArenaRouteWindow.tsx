import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  CollectionPanel,
  DecksPanel,
  DiagnosticsPanel,
  DraftPanel,
  ImportsPanel,
  InventoryPanel,
  PrivacyPanel,
  SettingsPanel,
  SetupPanel,
} from "../components/route-panels";
import { ArenacApi, DEFAULT_ARENAC_API_BASE } from "../lib/api/client";
import { mapToArenaAppShellInput } from "../lib/api/mapStoreToShell";
import type { ImportCenterSummary } from "../routes/imports/index";
import { ArenaSideNav } from "./ArenaSideNav";
import {
  buildArenaAppShellState,
  type ArenaAppShellState,
} from "./buildArenaAppShellState";
import type { ArenaRouteId } from "./routes";

const ROUTE_TITLES: Record<Exclude<ArenaRouteId, "match-history" | "setup">, string> = {
  imports: "Imports",
  collection: "Collection",
  inventory: "Inventory",
  draft: "Draft",
  decks: "Decks",
  diagnostics: "Diagnostics",
  privacy: "Privacy",
  settings: "Settings",
};

const ROUTE_SUBTITLES: Record<Exclude<ArenaRouteId, "match-history" | "setup">, string> = {
  imports: "Desktop and iOS offline imports for MTG Arena logs.",
  collection: "Local Collection snapshot from your Arena log.",
  inventory: "Local Inventory snapshot from your Arena log.",
  draft: "Recorded draft picks from local Arena log sessions.",
  decks: "Decks tracked locally; Archidekt sync is opt-in.",
  diagnostics: "Parser warnings and unknown events from recent imports.",
  privacy: "Network posture and what stays on this device.",
  settings: "Local settings, consent toggles, and connection wizard.",
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

const refreshButton: CSSProperties = {
  border: "1px solid #35507a",
  borderRadius: 999,
  background: "#192334",
  color: "#f7f9fc",
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function NoSidecar(props: { onRetry: () => void }) {
  return (
    <div
      style={{
        background: "#141a25",
        border: "1px solid #24324a",
        borderRadius: 16,
        padding: 20,
        display: "grid",
        gap: 10,
        color: "#dce6f4",
      }}
    >
      <strong style={{ color: "#f7f9fc", fontSize: 18 }}>Companion service unavailable</strong>
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14, lineHeight: 1.45 }}>
        Start <code>mancutg-arenac.exe serve --port 17890</code> next to this window, then press
        Refresh.
      </p>
      <div>
        <button type="button" style={refreshButton} onClick={props.onRetry}>
          Refresh
        </button>
      </div>
    </div>
  );
}

export function ArenaRouteWindow(props: {
  routeId: Exclude<ArenaRouteId, "match-history">;
  defaultBaseUrl?: string;
  onNavigate: (id: ArenaRouteId) => void;
  onOpenSetupWizard?: () => void;
}) {
  const { routeId, onNavigate, onOpenSetupWizard } = props;
  const baseUrl = props.defaultBaseUrl ?? DEFAULT_ARENAC_API_BASE;
  const apiRef = useRef(new ArenacApi(baseUrl));
  const [shell, setShell] = useState<ArenaAppShellState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceReachable, setServiceReachable] = useState<boolean>(true);

  const reload = useRef<() => Promise<void>>(async () => {});
  reload.current = async () => {
    try {
      setError(null);
      const api = apiRef.current;
      const [store, settings, status] = await Promise.all([
        api.storeSummary(),
        api.settings(),
        api.status(),
      ]);
      setServiceReachable(true);
      setShell(
        buildArenaAppShellState(
          mapToArenaAppShellInput({
            store,
            settings,
            service: status,
            watcherRunning: false,
            lastImportSummary: null,
          }),
        ),
      );
    } catch (err: unknown) {
      setServiceReachable(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void reload.current();
  }, []);

  const refreshButtonNode = (
    <button type="button" style={refreshButton} onClick={() => void reload.current()}>
      Refresh
    </button>
  );

  let body: ReactNode;
  if (!shell || !serviceReachable) {
    body = <NoSidecar onRetry={() => void reload.current()} />;
  } else {
    body = renderRoutePanel(routeId, shell, {
      onOpenSetupWizard,
      onImportArchidekt: undefined,
    });
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
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
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
            <h1 style={{ margin: "4px 0 0", color: "#f7f9fc", fontSize: 28 }}>
              {routeId === "setup" ? "Setup" : ROUTE_TITLES[routeId]}
            </h1>
            <p style={{ margin: "4px 0 0", color: "#8ea0bc", fontSize: 14 }}>
              {routeId === "setup"
                ? "Connection and Player.log wizard."
                : ROUTE_SUBTITLES[routeId]}
            </p>
          </div>
          {refreshButtonNode}
        </header>
        {error ? <div style={errorBox}>{error}</div> : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: 20,
          }}
        >
          <ArenaSideNav active={routeId} onNavigate={onNavigate} />
          <section style={{ display: "grid", gap: 20 }}>{body}</section>
        </div>
      </div>
    </main>
  );
}

function renderRoutePanel(
  routeId: Exclude<ArenaRouteId, "match-history">,
  shell: ArenaAppShellState,
  options: {
    onOpenSetupWizard?: () => void;
    onImportArchidekt?: () => void;
  },
): ReactNode {
  switch (routeId) {
    case "setup":
      return <SetupPanel state={shell.setup} />;
    case "imports":
      return <ImportsPanel state={shell.imports} variant="detail" />;
    case "collection":
      return <CollectionPanel state={shell.collection} />;
    case "inventory":
      return <InventoryPanel state={shell.inventory} />;
    case "draft":
      return <DraftPanel state={shell.draft} variant="detail" />;
    case "decks":
      return (
        <DecksPanel
          state={shell.decks}
          variant="detail"
          onImportArchidekt={options.onImportArchidekt}
        />
      );
    case "diagnostics":
      return <DiagnosticsPanel state={shell.diagnostics} variant="detail" />;
    case "privacy":
      return <PrivacyPanel state={shell.privacy} />;
    case "settings":
      return (
        <SettingsPanel state={shell.settings} onOpenSetupWizard={options.onOpenSetupWizard} />
      );
  }
}

export type { ArenaAppShellState };

/**
 * Renders just the body of a single route without the per-window header/sidebar,
 * useful for SSR snapshot tests.
 */
export function renderArenaRouteContent(
  routeId: Exclude<ArenaRouteId, "match-history">,
  shell: ArenaAppShellState,
): ReactNode {
  return renderRoutePanel(routeId, shell, {});
}
