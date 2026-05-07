import { createRoot } from "react-dom/client";

import { ArenaClientApp } from "../../desktop/src/client/ArenaClientApp";
import { DEFAULT_ARENAC_API_BASE } from "../../desktop/src/lib/api/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}

createRoot(root).render(<ArenaClientApp defaultBaseUrl={DEFAULT_ARENAC_API_BASE} />);
