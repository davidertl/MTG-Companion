import { ShellPanel } from "../components/ShellPanel";
import { SummaryMetric } from "../components/SummaryMetric";
import { ActionCluster } from "../components/ActionCluster";
import type { ArenaAppShellState } from "./buildArenaAppShellState";

export function ArenaAppShell(props: {
  state: ArenaAppShellState;
  onAction?: (label: string) => void;
}) {
  const { state, onAction } = props;

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

          <ShellPanel
            title="System pulse"
            subtitle="Arena-first operational snapshot"
          >
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
              <SummaryMetric
                label="Known matches"
                value={state.history.totalMatches}
              />
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
            {state.nav.map((item) => (
              <div
                key={item}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  color: item === "Imports" ? "#f7f9fc" : "#b6c5da",
                  background: item === "Imports" ? "#182336" : "transparent",
                  fontWeight: item === "Imports" ? 700 : 500,
                }}
              >
                {item}
              </div>
            ))}
          </aside>

          <section style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <ShellPanel title="Setup" subtitle={state.setup.banner}>
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

              <ShellPanel
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
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <ShellPanel title="Match History" subtitle={`Last deck: ${state.history.lastDeck ?? "none"}`}>
                <SummaryMetric label="Matches" value={state.history.totalMatches} />
              </ShellPanel>

              <ShellPanel title="Collection" subtitle={state.collection.message}>
                <SummaryMetric
                  label="Cards owned"
                  value={state.collection.cardsOwned}
                />
              </ShellPanel>

              <ShellPanel title="Inventory" subtitle={state.inventory.message}>
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
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 20,
              }}
            >
              <ShellPanel title="Draft" subtitle={state.draft.summary}>
                <SummaryMetric label="Picks" value={state.draft.picks.length} />
              </ShellPanel>

              <ShellPanel title={state.decks.title} subtitle={state.decks.statusMessage}>
                <div style={{ display: "grid", gap: 10 }}>
                  <SummaryMetric label="Decks" value={state.decks.totalDecks} />
                  <button
                    type="button"
                    style={{
                      border: "1px solid #35507a",
                      borderRadius: 12,
                      background: state.decks.archidektEnabled ? "#192334" : "#0d121b",
                      color: "#f7f9fc",
                      padding: "12px 14px",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {state.decks.importActionLabel}
                  </button>
                </div>
              </ShellPanel>

              <ShellPanel title="Diagnostics" subtitle="Import and parser visibility">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <SummaryMetric
                    label="Warnings"
                    value={state.diagnostics.warningCount}
                  />
                  <SummaryMetric
                    label="Unknown events"
                    value={state.diagnostics.unknownEventCount}
                  />
                </div>
              </ShellPanel>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 20,
              }}
            >
              <ShellPanel title="Privacy" subtitle={state.privacy.networkPosture}>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Telemetry: {state.privacy.telemetryEnabled ? "On" : "Off"}</li>
                  <li>Sync: {state.privacy.syncEnabled ? "On" : "Off"}</li>
                  <li>Archidekt access: {state.privacy.archidektEnabled ? "On" : "Off"}</li>
                </ul>
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

              <ShellPanel title="Settings" subtitle="Offline-first defaults are preserved">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Sync enabled: {state.settings.syncEnabled ? "Yes" : "No"}</li>
                  <li>
                    Telemetry enabled: {state.settings.telemetryEnabled ? "Yes" : "No"}
                  </li>
                  <li>
                    Archidekt enabled: {state.settings.archidektEnabled ? "Yes" : "No"}
                  </li>
                  <li>Offline capable: {state.settings.offlineCapable ? "Yes" : "No"}</li>
                  <li>Settings file: {state.settings.settingsFileName}</li>
                </ul>
                <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
                  {state.settings.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </ShellPanel>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
