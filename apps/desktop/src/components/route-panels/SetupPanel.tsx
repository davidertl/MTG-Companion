import type { ReactNode } from "react";

import type { ArenaAppShellState } from "../../app/buildArenaAppShellState";
import { ShellPanel } from "../ShellPanel";

export function SetupPanel(props: {
  state: ArenaAppShellState["setup"];
  footer?: ReactNode;
}) {
  return (
    <ShellPanel title="Setup" subtitle={props.state.banner}>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {props.state.checklist.map((item) => (
          <li key={item.id} style={{ marginBottom: 8 }}>
            <strong style={{ color: item.complete ? "#87e0a2" : "#f7f9fc" }}>
              {item.complete ? "Done" : "Pending"}
            </strong>{" "}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      {props.footer ? <div style={{ marginTop: 14 }}>{props.footer}</div> : null}
    </ShellPanel>
  );
}
