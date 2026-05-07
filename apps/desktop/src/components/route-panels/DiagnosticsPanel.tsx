import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

export function DiagnosticsPanel(props: {
  state: ArenaAppShellState["diagnostics"];
  variant?: "compact" | "detail";
}) {
  const { state, variant = "detail" } = props;
  const unknownEvents = state.unknownEvents;
  return (
    <ShellPanel title="Diagnostics" subtitle="Import and parser visibility">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <SummaryMetric label="Warnings" value={state.warningCount} />
        <SummaryMetric label="Unknown events" value={state.unknownEventCount} />
      </div>
      {variant === "detail" ? (
        <div style={{ display: "grid", gap: 12, marginTop: 6 }}>
          {state.diagnostics.length > 0 ? (
            <div>
              <strong style={{ color: "#f7f9fc", fontSize: 14 }}>Recent warnings</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "#dce6f4", fontSize: 13 }}>
                {state.diagnostics.slice(0, 30).map((row, i) => (
                  <li key={`${row.sessionId}-${i}`}>
                    <span style={{ color: "#9ec5ff" }}>{row.diagnosticKind}</span>{" "}
                    <span style={{ color: "#8ea0bc" }}>· {row.sessionId}</span>{" "}
                    <span>{row.message}</span>
                  </li>
                ))}
              </ul>
              {state.diagnostics.length > 30 ? (
                <p style={{ margin: 6, color: "#8ea0bc", fontSize: 12 }}>
                  Showing first 30 of {state.diagnostics.length} warnings.
                </p>
              ) : null}
            </div>
          ) : null}
          {unknownEvents.length > 0 ? (
            <div>
              <strong style={{ color: "#f7f9fc", fontSize: 14 }}>Unknown event labels</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "#dce6f4", fontSize: 13 }}>
                {unknownEvents.slice(0, 30).map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </ShellPanel>
  );
}
