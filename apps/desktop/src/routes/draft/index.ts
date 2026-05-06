export interface DraftPickView {
  setCode: string;
  packNumber: number;
  pickNumber: number;
  choice: string;
}

export function buildDraftRouteState(picks: DraftPickView[]) {
  return {
    empty: picks.length === 0,
    picks,
    summary:
      picks.length > 0
        ? `${picks.length} Draft-Picks lokal aufgezeichnet`
        : "Noch keine Draft-Picks verfuegbar.",
  };
}

export const getDraftRouteState = buildDraftRouteState;
