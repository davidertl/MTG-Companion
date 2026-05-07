import type { ReactNode } from "react";

import { ShellPanel } from "../components/ShellPanel";
import { SummaryMetric } from "../components/SummaryMetric";
import { ActionCluster } from "../components/ActionCluster";
import {
  CollectionPanel,
  DecksPanel,
  DiagnosticsPanel,
  DraftPanel,
  ImportsPanel,
  InventoryPanel,
  MatchHistoryPanel,
  PrivacyPanel,
  SettingsPanel,
  SetupPanel,
} from "../components/route-panels";
import { ArenaSideNav } from "./ArenaSideNav";
import type { ArenaRouteId } from "./routes";
import type { ArenaAppShellState } from "./buildArenaAppShellState";

export function ArenaAppShell(props: {
  state: ArenaAppShellState;
  /** When set, replaces the default action button cluster (e.g. live UI toolbar). */
  toolbarSlot?: ReactNode;
  /** Rendered below the Setup checklist (e.g. Detailed Logs acknowledgment). */
  setupPanelFooter?: ReactNode;
  /** Opens the Overwolf setup window for service URL and log path (Overwolf only). */
  onOpenSetupWizard?: () => void;
  /** Highlighted nav entry. Defaults to "imports" for back-compat with the dashboard SSR helper. */
  activeRoute?: ArenaRouteId;
  /** Side nav click handler. When omitted, nav is rendered but inert. */
  onNavigate?: (id: ArenaRouteId) => void;
}) {
  const {
    state,
    toolbarSlot,
    setupPanelFooter,
    onOpenSetupWizard,
    activeRoute = "imports",
    onNavigate,
  } = props;

  const navigate = onNavigate ?? (() => {});

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
          gap: 24,
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.8fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          <section
            style={{
              display: "grid",
              gap: 16,
              padding: 28,
              background:
                "linear-gradient(135deg, rgba(79,140,255,0.18), rgba(18,25,37,0.9))",
              border: "1px solid #24324a",
              borderRadius: 24,
            }}
          >
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
            <div style={{ display: "grid", gap: 10 }}>
              <h1
                style={{
                  margin: 0,
                  color: "#f7f9fc",
                  fontSize: 38,
                  lineHeight: 1.05,
                }}
              >
                {state.title}
              </h1>
              <p style={{ margin: 0, color: "#b6c5da", maxWidth: 640, fontSize: 17 }}>
                {state.subtitle}
              </p>
            </div>
            {toolbarSlot ?? (
              <ActionCluster
                labels={[
                  state.watcherRunning
                    ? state.actions.stopWatcherLabel
                    : state.actions.startWatcherLabel,
                  state.actions.importLocalLabel,
                  state.actions.importIosFileLabel,
                  state.actions.importIosFolderLabel,
                  state.actions.exportBackupLabel,
                  state.actions.refreshLabel,
                ]}
              />
            )}
          </section>

          <ShellPanel title="System pulse" subtitle="Arena-first operational snapshot">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              <SummaryMetric
                label="Watcher"
                value={state.watcherRunning ? "Running" : "Idle"}
              />
              <SummaryMetric label="Known matches" value={state.history.totalMatches} />
              <SummaryMetric
                label="Imported sessions"
                value={state.imports.lastImportSummary?.importedSessions ?? 0}
              />
              <SummaryMetric
                label="Diagnostics"
                value={state.diagnostics.warningCount + state.diagnostics.unknownEventCount}
              />
            </div>
          </ShellPanel>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: 20,
          }}
        >
          <ArenaSideNav active={activeRoute} onNavigate={navigate} />

          <section style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <SetupPanel state={state.setup} footer={setupPanelFooter} />
              <ImportsPanel state={state.imports} variant="compact" />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <MatchHistoryPanel state={state.history} variant="compact" />
              <CollectionPanel state={state.collection} />
              <InventoryPanel state={state.inventory} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 20,
              }}
            >
              <DraftPanel state={state.draft} variant="compact" />
              <DecksPanel state={state.decks} variant="compact" />
              <DiagnosticsPanel state={state.diagnostics} variant="compact" />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <PrivacyPanel state={state.privacy} />
              <SettingsPanel
                state={state.settings}
                onOpenSetupWizard={onOpenSetupWizard}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
