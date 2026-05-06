export type CollectionSummary = {
  cardsOwned: number;
  capturedAt: string;
};

export function getCollectionRouteState(snapshot?: CollectionSummary) {
  if (!snapshot) {
    return {
      empty: true,
      title: "Collection",
      cardsOwned: 0,
      capturedAt: null,
      message: "Noch keine lokale Collection-Snapshot vorhanden.",
    };
  }

  return {
    empty: false,
    title: "Collection",
    cardsOwned: snapshot.cardsOwned,
    capturedAt: snapshot.capturedAt,
    message: `${snapshot.cardsOwned} Karten lokal erfasst`,
  };
}

export const buildCollectionRouteState = getCollectionRouteState;
