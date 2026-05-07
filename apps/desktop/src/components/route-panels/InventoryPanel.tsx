import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

export function InventoryPanel(props: { state: ArenaAppShellState["inventory"] }) {
  const { state } = props;
  return (
    <ShellPanel title="Inventory" subtitle={state.message}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <SummaryMetric label="Gold" value={state.gold} />
        <SummaryMetric label="Gems" value={state.gems} />
        <SummaryMetric label="Wildcards" value={state.wildcards} />
        <SummaryMetric label="Vault" value={state.vault} />
      </div>
      {state.capturedAt ? (
        <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
          Snapshot captured at {state.capturedAt}
        </p>
      ) : null}
    </ShellPanel>
  );
}
