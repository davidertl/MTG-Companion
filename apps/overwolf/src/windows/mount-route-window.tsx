import { createRoot } from "react-dom/client";

import { ArenaRouteWindow } from "../../../desktop/src/app/ArenaRouteWindow";
import { findRoute, type ArenaRouteId } from "../../../desktop/src/app/routes";
import { DEFAULT_ARENAC_API_BASE } from "../../../desktop/src/lib/api/client";
import { openOverwolfWindow, openSetupOverwolfWindow } from "../overwolf-bridge";

/**
 * Mounts a single route into the current Overwolf window. Each per-topic HTML
 * file (imports.html, collection.html, ...) imports this and calls it with the
 * matching route ID.
 */
export function mountRouteWindow(routeId: Exclude<ArenaRouteId, "match-history">): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("missing #root");
  }

  function navigate(target: ArenaRouteId): void {
    const targetRoute = findRoute(target);
    openOverwolfWindow(targetRoute.overwolfWindow, (message) => {
      console.error(message);
    });
  }

  createRoot(root).render(
    <ArenaRouteWindow
      routeId={routeId}
      defaultBaseUrl={DEFAULT_ARENAC_API_BASE}
      onNavigate={navigate}
      onOpenSetupWizard={() => openSetupOverwolfWindow((message) => console.error(message))}
    />,
  );
}
