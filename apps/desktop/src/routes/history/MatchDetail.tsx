import type { MatchDetailState } from "./index";

/**
 * Renders a per-match event timeline from the pure `buildMatchDetailState`
 * view model. All data comes from the `inspect_match` command via the host;
 * this component is presentational only.
 */
export function MatchDetail(props: {
  state: MatchDetailState | null;
  loading?: boolean;
}) {
  const { state, loading } = props;

  if (loading) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>Lade Match-Details…</p>
    );
  }

  if (!state) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
        Wähle ein Match aus der Liste, um die Ereignis-Timeline zu sehen.
      </p>
    );
  }

  if (state.empty) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
        Keine Ereignisse für Match {state.matchId} gespeichert.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
        {state.eventCount} Ereignis{state.eventCount === 1 ? "" : "se"} · Match{" "}
        {state.matchId}
      </p>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {state.timeline.map((entry) => (
          <li
            key={`${entry.sequence}-${entry.eventType}`}
            style={{
              background: "#0d121b",
              border: "1px solid #24324a",
              borderRadius: 12,
              padding: "10px 12px",
              display: "grid",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "baseline",
              }}
            >
              <strong style={{ color: "#9ec5ff", fontSize: 14 }}>
                {entry.eventType}
              </strong>
              <span style={{ color: "#8ea0bc", fontSize: 12 }}>{entry.timestamp}</span>
            </div>
            <span style={{ color: "#b6c5da", fontSize: 13, wordBreak: "break-word" }}>
              {entry.summary}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
