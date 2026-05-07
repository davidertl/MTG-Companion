import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";

export function SettingsPanel(props: {
  state: ArenaAppShellState["settings"];
  onOpenSetupWizard?: () => void;
}) {
  const { state, onOpenSetupWizard } = props;
  return (
    <ShellPanel title="Settings" subtitle="Offline-first defaults are preserved">
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>Sync enabled: {state.syncEnabled ? "Yes" : "No"}</li>
        <li>Telemetry enabled: {state.telemetryEnabled ? "Yes" : "No"}</li>
        <li>Archidekt enabled: {state.archidektEnabled ? "Yes" : "No"}</li>
        <li>
          Detailed Logs (Arena):{" "}
          {state.detailedLogsAcknowledged ? "Acknowledged" : "Not acknowledged"}
        </li>
        <li>Offline capable: {state.offlineCapable ? "Yes" : "No"}</li>
        <li>Settings file: {state.settingsFileName}</li>
      </ul>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
        {state.actions.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ul>
      {onOpenSetupWizard ? (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={onOpenSetupWizard}
            style={{
              border: "1px solid #35507a",
              borderRadius: 12,
              background: "#192334",
              color: "#f7f9fc",
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Connection &amp; log path wizard
          </button>
        </div>
      ) : null}
    </ShellPanel>
  );
}
