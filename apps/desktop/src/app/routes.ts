/**
 * Central registry of ArenaC navigation routes.
 *
 * `overwolfWindow` is the window name declared in `apps/overwolf/public/manifest.json`.
 * `match-history` is hosted by the Main window (no separate HTML), every other route
 * has its own dedicated Overwolf window.
 */

export type ArenaRouteId =
  | "match-history"
  | "imports"
  | "collection"
  | "inventory"
  | "draft"
  | "decks"
  | "diagnostics"
  | "privacy"
  | "settings"
  | "setup";

export interface ArenaRouteEntry {
  id: ArenaRouteId;
  label: string;
  overwolfWindow: string;
}

export const ARENA_ROUTES: readonly ArenaRouteEntry[] = [
  { id: "match-history", label: "Match History", overwolfWindow: "main" },
  { id: "imports", label: "Imports", overwolfWindow: "imports" },
  { id: "collection", label: "Collection", overwolfWindow: "collection" },
  { id: "inventory", label: "Inventory", overwolfWindow: "inventory" },
  { id: "draft", label: "Draft", overwolfWindow: "draft" },
  { id: "decks", label: "Decks", overwolfWindow: "decks" },
  { id: "diagnostics", label: "Diagnostics", overwolfWindow: "diagnostics" },
  { id: "privacy", label: "Privacy", overwolfWindow: "privacy" },
  { id: "settings", label: "Settings", overwolfWindow: "settings" },
  { id: "setup", label: "Setup", overwolfWindow: "setup" },
];

export function findRoute(id: ArenaRouteId): ArenaRouteEntry {
  const entry = ARENA_ROUTES.find((route) => route.id === id);
  if (!entry) {
    throw new Error(`Unknown ArenaRouteId: ${id}`);
  }
  return entry;
}
