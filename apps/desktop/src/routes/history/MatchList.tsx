import type { MatchHistoryRecord } from "../../lib/query/history";

const RESULT_COLORS: Record<string, string> = {
  win: "#87e0a2",
  loss: "#ff8080",
  unknown: "#b6c5da",
};

/**
 * Renders the full local match history as a selectable list. Consumes the
 * already-built `records[]` from `buildHistoryRouteState`; selecting a row
 * asks the host to load that match's event timeline.
 */
export function MatchList(props: {
  records: MatchHistoryRecord[];
  selectedMatchId?: string | null;
  onSelect?: (matchId: string) => void;
}) {
  const { records, selectedMatchId, onSelect } = props;

  if (records.length === 0) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
        Noch keine Matches lokal aufgezeichnet.
      </p>
    );
  }

  return (
    <div role="list" style={{ display: "grid", gap: 8 }}>
      {records.map((record) => {
        const selected = record.matchId === selectedMatchId;
        return (
          <button
            key={record.matchId}
            type="button"
            role="listitem"
            aria-pressed={selected}
            onClick={() => onSelect?.(record.matchId)}
            style={{
              textAlign: "left",
              border: `1px solid ${selected ? "#4f8cff" : "#24324a"}`,
              borderRadius: 12,
              background: selected ? "#182336" : "#0d121b",
              color: "#dce6f4",
              padding: "12px 14px",
              cursor: "pointer",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ display: "grid", gap: 2 }}>
              <strong style={{ color: "#f7f9fc" }}>
                {record.deck || "Unbekanntes Deck"}
              </strong>
              <span style={{ color: "#8ea0bc", fontSize: 13 }}>
                {record.matchId}
                {record.queue ? ` · ${record.queue}` : ""}
              </span>
            </span>
            <span
              style={{
                color: RESULT_COLORS[record.result] ?? "#b6c5da",
                fontWeight: 700,
                fontSize: 13,
                textTransform: "uppercase",
              }}
            >
              {record.result}
            </span>
          </button>
        );
      })}
    </div>
  );
}
