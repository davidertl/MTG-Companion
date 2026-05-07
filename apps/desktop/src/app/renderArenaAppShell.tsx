import { renderToStaticMarkup } from "react-dom/server";

import { ArenaAppShell } from "./ArenaAppShell";
import type { ArenaAppShellState } from "./buildArenaAppShellState";

export function renderArenaAppShell(state: ArenaAppShellState): string {
  return renderToStaticMarkup(<ArenaAppShell state={state} />);
}
