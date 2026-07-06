import type {
  CardDbStatusView,
  FindingMarkerView,
  MatchAnalysisState,
  MatchDetailState,
  TimelineTurnView,
} from "./index";

/**
 * Renders the per-match analysis surface: the reconstructed turn-by-turn game
 * timeline (from `load_game_timeline`) with rule-check findings placed inline at
 * their turn, a suggestions panel, and a "Run analysis" action (`analyze_match`).
 *
 * All data comes from the pure view-model builders in `./index`; this component
 * is presentational only. Findings text shows `ruleRefs` and confidence
 * verbatim and never uses verdict language — findings are hints for a human.
 */

const SEVERITY_COLORS: Record<FindingMarkerView["severity"], string> = {
  info: "#5aa9ff",
  warning: "#f2c14e",
  "possible-violation": "#ff8a5b",
};

function FindingCard(props: { finding: FindingMarkerView }) {
  const { finding } = props;
  const accent = SEVERITY_COLORS[finding.severity] ?? "#8ea0bc";
  return (
    <div
      role="listitem"
      data-finding-code={finding.code}
      data-severity={finding.severity}
      style={{
        background: "#0d121b",
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
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
        <strong style={{ color: accent, fontSize: 13 }}>
          {finding.severityLabel} · {finding.code}
        </strong>
        <span style={{ color: "#8ea0bc", fontSize: 12 }}>{finding.confidenceLabel}</span>
      </div>
      <span style={{ color: "#dce6f4", fontSize: 13, wordBreak: "break-word" }}>
        {finding.description}
      </span>
      {finding.ruleRefs.length > 0 && (
        <span style={{ color: "#8ea0bc", fontSize: 12 }}>Rules: {finding.ruleRefsLabel}</span>
      )}
    </div>
  );
}

function TurnCard(props: { turn: TimelineTurnView }) {
  const { turn } = props;
  return (
    <li
      data-turn={turn.turnNumber}
      style={{
        background: "#0d121b",
        border: "1px solid #24324a",
        borderRadius: 12,
        padding: "12px 14px",
        display: "grid",
        gap: 8,
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
        <strong style={{ color: "#9ec5ff", fontSize: 14 }}>Turn {turn.turnNumber}</strong>
        <span style={{ color: "#8ea0bc", fontSize: 12 }}>
          {turn.activePlayer ? `Active: ${turn.activePlayer}` : "Active: unknown"}
          {turn.phase ? ` · ${turn.phase}` : ""}
          {turn.step ? ` · ${turn.step}` : ""}
        </span>
      </div>

      {turn.players.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 8,
          }}
        >
          {turn.players.map((player) => (
            <div
              key={player.player}
              style={{ color: "#b6c5da", fontSize: 12, display: "grid", gap: 2 }}
            >
              <strong style={{ color: "#dce6f4" }}>{player.player}</strong>
              <span>Life {player.life}</span>
              <span>
                Hand {player.handCount} · Library {player.libraryCount}
              </span>
              <span>
                Battlefield {player.battlefieldCount} · GY {player.graveyardCount} · Exile{" "}
                {player.exileCount}
              </span>
            </div>
          ))}
        </div>
      )}

      {turn.actions.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: "#b6c5da", fontSize: 12 }}>
          {turn.actions.map((action, index) => (
            <li key={`${turn.turnNumber}-action-${index}`}>{action.label}</li>
          ))}
        </ul>
      )}

      {turn.findings.length > 0 && (
        <div role="list" style={{ display: "grid", gap: 6 }}>
          {turn.findings.map((finding) => (
            <FindingCard key={finding.findingId} finding={finding} />
          ))}
        </div>
      )}
    </li>
  );
}

function CardDbGuidance(props: { cardDb: CardDbStatusView }) {
  if (props.cardDb.imported || !props.cardDb.guidance) {
    return null;
  }
  return (
    <div
      role="note"
      style={{
        background: "#141a12",
        border: "1px solid #4a5a2a",
        borderRadius: 12,
        padding: "10px 12px",
        color: "#d6e4b6",
        fontSize: 13,
      }}
    >
      {props.cardDb.guidance}
    </div>
  );
}

function AnalysisSection(props: {
  analysis: MatchAnalysisState;
  analysisLoading?: boolean;
  analysisEnabled?: boolean;
  onRunAnalysis?: () => void;
}) {
  const { analysis, analysisLoading, analysisEnabled = true, onRunAnalysis } = props;
  const { timeline, findings, cardDb } = analysis;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <span style={{ color: "#8ea0bc", fontSize: 13 }}>
          {timeline.empty
            ? "No reconstructed turns yet"
            : `${timeline.turns.length} turn${timeline.turns.length === 1 ? "" : "s"} reconstructed`}
          {timeline.partial ? ` · partial log${timeline.partialReason ? ` (${timeline.partialReason})` : ""}` : ""}
        </span>
        {analysisEnabled ? (
          <button
            type="button"
            onClick={() => onRunAnalysis?.()}
            disabled={analysisLoading}
            style={{
              border: "1px solid #4f8cff",
              borderRadius: 12,
              background: analysisLoading ? "#182336" : "#123",
              color: "#dce6f4",
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: analysisLoading ? "wait" : "pointer",
            }}
          >
            {analysisLoading ? "Analyzing…" : "Run analysis"}
          </button>
        ) : (
          <span style={{ color: "#8ea0bc", fontSize: 12 }}>Analysis disabled in Settings</span>
        )}
      </div>

      <CardDbGuidance cardDb={cardDb} />

      {timeline.empty ? (
        <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
          No per-turn timeline could be reconstructed from the stored events yet.
        </p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {timeline.turns.map((turn) => (
            <TurnCard key={turn.turnNumber} turn={turn} />
          ))}
        </ol>
      )}

      {timeline.unplacedFindings.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#8ea0bc", fontSize: 12 }}>Other findings</span>
          <div role="list" style={{ display: "grid", gap: 6 }}>
            {timeline.unplacedFindings.map((finding) => (
              <FindingCard key={finding.findingId} finding={finding} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "#9ec5ff", fontSize: 13, fontWeight: 700 }}>Suggestions</span>
        {findings.suggestions.length === 0 ? (
          <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
            {analysis.analysisRun
              ? "No move suggestions for this match."
              : "Run analysis to surface possible better lines."}
          </p>
        ) : (
          <div role="list" style={{ display: "grid", gap: 6 }}>
            {findings.suggestions.map((finding) => (
              <FindingCard key={finding.findingId} finding={finding} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MatchDetail(props: {
  state: MatchDetailState | null;
  loading?: boolean;
  analysis?: MatchAnalysisState | null;
  analysisLoading?: boolean;
  analysisEnabled?: boolean;
  onRunAnalysis?: () => void;
}) {
  const { state, loading, analysis, analysisLoading, analysisEnabled, onRunAnalysis } = props;

  if (loading) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>Lade Match-Details…</p>
    );
  }

  if (!state) {
    return (
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
        Wähle ein Match aus der Liste, um die Ereignis-Timeline und Analyse zu sehen.
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
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0, color: "#8ea0bc", fontSize: 13 }}>
        {state.eventCount} Ereignis{state.eventCount === 1 ? "" : "se"} · Match{" "}
        {state.matchId}
      </p>

      {analysis && (
        <AnalysisSection
          analysis={analysis}
          analysisLoading={analysisLoading}
          analysisEnabled={analysisEnabled}
          onRunAnalysis={onRunAnalysis}
        />
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "#8ea0bc", fontSize: 12 }}>Raw events</span>
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
                <strong style={{ color: "#9ec5ff", fontSize: 14 }}>{entry.eventType}</strong>
                <span style={{ color: "#8ea0bc", fontSize: 12 }}>{entry.timestamp}</span>
              </div>
              <span style={{ color: "#b6c5da", fontSize: 13, wordBreak: "break-word" }}>
                {entry.summary}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
