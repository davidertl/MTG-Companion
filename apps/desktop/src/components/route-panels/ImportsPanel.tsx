import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";

export function ImportsPanel(props: {
  state: ArenaAppShellState["imports"];
  variant?: "compact" | "detail";
}) {
  const { state, variant = "detail" } = props;
  return (
    <ShellPanel
      title={state.title}
      subtitle={state.summary ?? "Desktop and iOS offline imports are available from one place."}
    >
      <div style={{ display: "grid", gap: 10 }}>
        {state.availableMethods.map((method) => (
          <div
            key={method.id}
            style={{
              background: "#0d121b",
              border: "1px solid #24324a",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <strong style={{ display: "block", color: "#f7f9fc" }}>{method.label}</strong>
            <span style={{ color: "#8ea0bc", fontSize: 14 }}>{method.description}</span>
          </div>
        ))}
        <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>
          {state.iosGuidance.primaryGuidance}
        </p>
        {variant === "detail" ? (
          <ul style={{ margin: 0, paddingLeft: 20, color: "#8ea0bc", fontSize: 14 }}>
            {state.iosGuidance.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </ShellPanel>
  );
}
