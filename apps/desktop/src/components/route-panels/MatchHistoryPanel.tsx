import type { CSSProperties } from "react";

import type { HistoryRouteState } from "../../lib/query/history";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

const tableHead: CSSProperties = {
  textAlign: "left",
  color: "#8ea0bc",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  padding: "8px 10px",
  borderBottom: "1px solid #24324a",
};

const tableCell: CSSProperties = {
  padding: "10px",
  borderBottom: "1px solid #1a2434",
  color: "#dce6f4",
  fontSize: 14,
};

const resultBadge: Record<HistoryRouteState["records"][number]["result"], CSSProperties> = {
  win: { color: "#87e0a2", fontWeight: 700 },
  loss: { color: "#f7a8b8", fontWeight: 700 },
  unknown: { color: "#8ea0bc" },
};

export function MatchHistoryPanel(props: {
  state: HistoryRouteState;
  variant?: "compact" | "detail";
}) {
  const { state, variant = "detail" } = props;
  const subtitle = `Last deck: ${state.lastDeck ?? "none"}`;

  if (variant === "compact") {
    return (
      <ShellPanel title="Match History" subtitle={subtitle}>
        <SummaryMetric label="Matches" value={state.totalMatches} />
      </ShellPanel>
    );
  }

  return (
    <ShellPanel title="Match History" subtitle={subtitle}>
      <SummaryMetric label="Matches" value={state.totalMatches} />
      {state.records.length === 0 ? (
        <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
          No matches yet. The live watcher will populate this list as you play.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHead}>Match ID</th>
                <th style={tableHead}>Deck</th>
                <th style={tableHead}>Queue</th>
                <th style={tableHead}>Result</th>
              </tr>
            </thead>
            <tbody>
              {state.records.map((record) => (
                <tr key={record.matchId}>
                  <td style={{ ...tableCell, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                    {record.matchId}
                  </td>
                  <td style={tableCell}>{record.deck}</td>
                  <td style={tableCell}>{record.queue}</td>
                  <td style={{ ...tableCell, ...resultBadge[record.result] }}>{record.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ShellPanel>
  );
}
