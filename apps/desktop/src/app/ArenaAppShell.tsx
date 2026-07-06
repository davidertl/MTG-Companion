import type { ReactNode } from "react";
import { ShellPanel } from "../components/ShellPanel";
import { SummaryMetric } from "../components/SummaryMetric";
import { ActionCluster } from "../components/ActionCluster";
import { MatchList } from "../routes/history/MatchList";
import { MatchDetail } from "../routes/history/MatchDetail";
import type { MatchDetailState } from "../routes/history/index";
import type { ArenaAppShellState } from "./buildArenaAppShellState";

export type ArenaHistoryInteraction = {
  selectedMatchId?: string | null;
  onSelectMatch?: (matchId: string) => void;
  detail?: MatchDetailState | null;
  detailLoading?: boolean;
};

export function ArenaAppShell(props: {
  state: ArenaAppShellState;
  /**
   * Currently selected view. When omitted the shell renders every view stacked
   * (overview/static-render mode); when set it renders only that view — this is
   * the interactive navigation path driven by `main.tsx`.
   */
  activeView?: string;
  onSelectView?: (view: string) => void;
  onAction?: (label: string) => void;
  onToggleConsent?: (purpose: string, enabled: boolean) => void;
  history?: ArenaHistoryInteraction;
}) {
  const {
    state,
    activeView,
    onSelectView,
    onAction,
    onToggleConsent,
    history,
  } = props;

  const consentToggle = (purpose: string, label: string, enabled: boolean) => (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "#dce6f4",
        fontSize: 14,
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onToggleConsent?.(purpose, event.target.checked)}
        aria-label={label}
      />
      <span>{label}</span>
    </label>
  );

  const renderView = (view: string): ReactNode => {
    switch (view) {
      case "Setup":
        return (
          <ShellPanel key="Setup" title="Setup" subtitle={state.setup.banner}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {state.setup.checklist.map((item) => (
                <li key={item.id} style={{ marginBottom: 8 }}>
                  <strong style={{ color: item.complete ? "#87e0a2" : "#f7f9fc" }}>
                    {item.complete ? "Done" : "Pending"}
                  </strong>{" "}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </ShellPanel>
        );
      case "Imports":
        return (
          <ShellPanel
            key="Imports"
            title={state.imports.title}
            subtitle={
              state.imports.summary ??
              "Desktop and iOS offline imports are available from one place."
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              {state.imports.availableMethods.map((method) => (
                <div
                  key={method.id}
                  style={{
                    background: "#0d121b",
                    border: "1px solid #24324a",
                    borderRadius: 14,
                    padding: 14,
                  }}
                >
                  <strong style={{ display: "block", color: "#f7f9fc" }}>
                    {method.label}
                  </strong>
                  <span style={{ color: "#8ea0bc", fontSize: 14 }}>
                    {method.description}
                  </span>
                </div>
              ))}
              <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
                {state.imports.iosGuidance.primaryGuidance}
              </p>
            </div>
          </ShellPanel>
        );
      case "Match History":
        return (
          <div
            key="Match History"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
              gap: 16,
            }}
          >
            <ShellPanel
              title="Match History"
              subtitle={`Last deck: ${state.history.lastDeck ?? "none"}`}
            >
              <MatchList
                records={state.history.records}
                selectedMatchId={history?.selectedMatchId}
                onSelect={history?.onSelectMatch}
              />
            </ShellPanel>
            <ShellPanel title="Match Detail" subtitle="Per-match event timeline">
              <MatchDetail
                state={history?.detail ?? null}
                loading={history?.detailLoading}
              />
            </ShellPanel>
          </div>
        );
      case "Collection":
        return (
          <ShellPanel key="Collection" title="Collection" subtitle={state.collection.message}>
            <SummaryMetric label="Cards owned" value={state.collection.cardsOwned} />
          </ShellPanel>
        );
      case "Inventory":
        return (
          <ShellPanel key="Inventory" title="Inventory" subtitle={state.inventory.message}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <SummaryMetric label="Gold" value={state.inventory.gold} />
              <SummaryMetric label="Gems" value={state.inventory.gems} />
              <SummaryMetric label="Wildcards" value={state.inventory.wildcards} />
              <SummaryMetric label="Vault" value={state.inventory.vault} />
            </div>
          </ShellPanel>
        );
      case "Draft":
        return (
          <ShellPanel key="Draft" title="Draft" subtitle={state.draft.summary}>
            {state.draft.picks.length === 0 ? (
              <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
                Noch keine Draft-Picks verfuegbar.
              </p>
            ) : (
              <div role="list" style={{ display: "grid", gap: 8 }}>
                {state.draft.picks.map((pick) => (
                  <div
                    key={`${pick.setCode}-${pick.packNumber}-${pick.pickNumber}`}
                    role="listitem"
                    style={{
                      background: "#0d121b",
                      border: "1px solid #24324a",
                      borderRadius: 12,
                      padding: "10px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <strong style={{ color: "#f7f9fc" }}>{pick.choice}</strong>
                    <span style={{ color: "#8ea0bc", fontSize: 13 }}>
                      {pick.setCode} · P{pick.packNumber}P{pick.pickNumber}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ShellPanel>
        );
      case "Decks":
        return (
          <ShellPanel key="Decks" title={state.decks.title} subtitle={state.decks.statusMessage}>
            <div style={{ display: "grid", gap: 10 }}>
              <SummaryMetric label="Decks" value={state.decks.totalDecks} />
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Archidekt import is coming soon"
                style={{
                  border: "1px solid #24324a",
                  borderRadius: 12,
                  background: "#0d121b",
                  color: "#8ea0bc",
                  padding: "12px 14px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "not-allowed",
                }}
              >
                {state.decks.importActionLabel}
              </button>
              <span style={{ color: "#8ea0bc", fontSize: 13 }}>
                Archidekt import — coming soon
              </span>
            </div>
          </ShellPanel>
        );
      case "Diagnostics":
        return (
          <ShellPanel
            key="Diagnostics"
            title="Diagnostics"
            subtitle="Import and parser visibility"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <SummaryMetric label="Warnings" value={state.diagnostics.warningCount} />
              <SummaryMetric
                label="Unknown events"
                value={state.diagnostics.unknownEventCount}
              />
            </div>
            {state.diagnostics.diagnostics.length === 0 ? (
              <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
                Keine Diagnostics aufgezeichnet.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                {state.diagnostics.diagnostics.map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.sessionId}-${index}`}
                    style={{ color: "#b6c5da", fontSize: 13 }}
                  >
                    <strong style={{ color: "#f7f9fc" }}>
                      {diagnostic.diagnosticKind}
                    </strong>{" "}
                    <span>{diagnostic.message}</span>{" "}
                    <span style={{ color: "#8ea0bc" }}>({diagnostic.sourcePath})</span>
                  </li>
                ))}
              </ul>
            )}
          </ShellPanel>
        );
      case "Privacy":
        return (
          <ShellPanel key="Privacy" title="Privacy" subtitle={state.privacy.networkPosture}>
            <div style={{ display: "grid", gap: 8 }}>
              {consentToggle("telemetry", "Telemetry", state.privacy.telemetryEnabled)}
              {consentToggle("sync", "Sync", state.privacy.syncEnabled)}
              {consentToggle("archidekt", "Archidekt access", state.privacy.archidektEnabled)}
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
              {state.privacy.localDataStays.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
              {state.privacy.outboundDataUses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ShellPanel>
        );
      case "Settings":
        return (
          <ShellPanel
            key="Settings"
            title="Settings"
            subtitle="Offline-first defaults are preserved"
          >
            <div style={{ display: "grid", gap: 8 }}>
              {consentToggle("sync", "Sync enabled", state.settings.syncEnabled)}
              {consentToggle(
                "telemetry",
                "Telemetry enabled",
                state.settings.telemetryEnabled,
              )}
              {consentToggle("archidekt", "Archidekt enabled", state.settings.archidektEnabled)}
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Offline capable: {state.settings.offlineCapable ? "Yes" : "No"}</li>
              <li>Settings file: {state.settings.settingsFileName}</li>
            </ul>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
              {state.settings.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </ShellPanel>
        );
      default:
        return null;
    }
  };

  const viewsToRender = activeView
    ? state.nav.filter((view) => view === activeView)
    : state.nav;

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
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 24 }}>
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
              <h1 style={{ margin: 0, color: "#f7f9fc", fontSize: 38, lineHeight: 1.05 }}>
                {state.title}
              </h1>
              <p style={{ margin: 0, color: "#b6c5da", maxWidth: 640, fontSize: 17 }}>
                {state.subtitle}
              </p>
            </div>
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
              onClick={onAction}
            />
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
                value={
                  state.diagnostics.warningCount + state.diagnostics.unknownEventCount
                }
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
          <aside
            style={{
              background: "#0f1520",
              border: "1px solid #24324a",
              borderRadius: 20,
              padding: 20,
              display: "grid",
              gap: 12,
              alignContent: "start",
            }}
          >
            <span
              style={{
                color: "#8ea0bc",
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Navigation
            </span>
            {state.nav.map((item) => {
              const isActive = activeView === item;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={isActive}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelectView?.(item)}
                  style={{
                    textAlign: "left",
                    border: "none",
                    padding: "10px 12px",
                    borderRadius: 12,
                    color: isActive ? "#f7f9fc" : "#b6c5da",
                    background: isActive ? "#182336" : "transparent",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {item}
                </button>
              );
            })}
          </aside>

          <section style={{ display: "grid", gap: 20 }}>
            {viewsToRender.map((view) => renderView(view))}
          </section>
        </div>
      </div>
    </main>
  );
}
