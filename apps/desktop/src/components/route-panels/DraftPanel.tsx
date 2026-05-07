import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

export function DraftPanel(props: {
  state: ArenaAppShellState["draft"];
  variant?: "compact" | "detail";
}) {
  const { state, variant = "detail" } = props;
  if (variant === "compact") {
    return (
      <ShellPanel title="Draft" subtitle={state.summary}>
        <SummaryMetric label="Picks" value={state.picks.length} />
      </ShellPanel>
    );
  }
  return (
    <ShellPanel title="Draft" subtitle={state.summary}>
      <SummaryMetric label="Picks" value={state.picks.length} />
      {state.picks.length === 0 ? null : (
        <ul style={{ margin: 0, paddingLeft: 20, color: "#dce6f4", fontSize: 14 }}>
          {state.picks.map((pick, index) => (
            <li key={`${pick.setCode}-${pick.packNumber}-${pick.pickNumber}-${index}`}>
              <strong>{pick.setCode}</strong> · Pack {pick.packNumber} Pick {pick.pickNumber}{" "}
              · <span style={{ color: "#9ec5ff" }}>{pick.choice}</span>
            </li>
          ))}
        </ul>
      )}
    </ShellPanel>
  );
}
