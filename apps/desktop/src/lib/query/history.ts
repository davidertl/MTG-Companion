export type MatchHistoryRecord = {
  matchId: string;
  deck: string;
  result: "win" | "loss" | "unknown";
  queue: string;
};

export type HistoryRouteState = {
  empty: boolean;
  totalMatches: number;
  lastDeck: string | null;
  records: MatchHistoryRecord[];
};

export function buildHistoryRouteState(records: MatchHistoryRecord[]): HistoryRouteState {
  return {
    empty: records.length === 0,
    totalMatches: records.length,
    lastDeck: records.at(-1)?.deck ?? null,
    records,
  };
}
