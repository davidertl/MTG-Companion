import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

export function CollectionPanel(props: { state: ArenaAppShellState["collection"] }) {
  const { state } = props;
  return (
    <ShellPanel title="Collection" subtitle={state.message}>
      <SummaryMetric label="Cards owned" value={state.cardsOwned} />
      {state.capturedAt ? (
        <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
          Snapshot captured at {state.capturedAt}
        </p>
      ) : null}
    </ShellPanel>
  );
}
