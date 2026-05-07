import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";
import { SummaryMetric } from "../SummaryMetric";

export function DecksPanel(props: {
  state: ArenaAppShellState["decks"];
  onImportArchidekt?: () => void;
  variant?: "compact" | "detail";
}) {
  const { state, onImportArchidekt, variant = "detail" } = props;
  return (
    <ShellPanel title={state.title} subtitle={state.statusMessage}>
      <div style={{ display: "grid", gap: 10 }}>
        <SummaryMetric label="Decks" value={state.totalDecks} />
        <button
          type="button"
          onClick={onImportArchidekt}
          disabled={!state.archidektEnabled || !onImportArchidekt}
          style={{
            border: "1px solid #35507a",
            borderRadius: 12,
            background: state.archidektEnabled ? "#192334" : "#0d121b",
            color: "#f7f9fc",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            cursor: state.archidektEnabled && onImportArchidekt ? "pointer" : "default",
            opacity: state.archidektEnabled && onImportArchidekt ? 1 : 0.7,
          }}
        >
          {state.importActionLabel}
        </button>
        {variant === "detail" && state.deckNames.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 20, color: "#dce6f4", fontSize: 14 }}>
            {state.deckNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </ShellPanel>
  );
}
