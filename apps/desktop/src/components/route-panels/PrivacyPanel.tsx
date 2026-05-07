import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";

export function PrivacyPanel(props: { state: ArenaAppShellState["privacy"] }) {
  const { state } = props;
  return (
    <ShellPanel title="Privacy" subtitle={state.networkPosture}>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>Telemetry: {state.telemetryEnabled ? "On" : "Off"}</li>
        <li>Sync: {state.syncEnabled ? "On" : "Off"}</li>
        <li>Archidekt access: {state.archidektEnabled ? "On" : "Off"}</li>
      </ul>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
        {state.localDataStays.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc" }}>
        {state.outboundDataUses.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </ShellPanel>
  );
}
