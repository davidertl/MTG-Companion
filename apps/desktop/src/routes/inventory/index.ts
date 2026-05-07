export type InventorySummary = {
  gold: number;
  gems: number;
  wildcards: number;
  vault: number;
  capturedAt: string;
};

export function buildInventoryRouteState(snapshot?: InventorySummary) {
  if (!snapshot) {
    return {
      empty: true,
      title: "Inventory",
      gold: 0,
      gems: 0,
      wildcards: 0,
      vault: 0,
      capturedAt: null,
      message: "Noch keine lokale Inventory-Snapshot vorhanden.",
    };
  }

  return {
    empty: false,
    title: "Inventory",
    gold: snapshot.gold,
    gems: snapshot.gems,
    wildcards: snapshot.wildcards,
    vault: snapshot.vault,
    capturedAt: snapshot.capturedAt,
    message: `${snapshot.gold} Gold / ${snapshot.gems} Gems lokal erfasst`,
  };
}
