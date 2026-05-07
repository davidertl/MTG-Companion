import { createRoot } from "react-dom/client";

import { ArenaClientApp } from "@arenac/client/ArenaClientApp";
import { DEFAULT_ARENAC_API_BASE } from "@arenac/lib/api/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}

createRoot(root).render(<ArenaClientApp defaultBaseUrl={DEFAULT_ARENAC_API_BASE} />);
