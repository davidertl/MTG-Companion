import {
  buildHistoryRouteState,
  type MatchHistoryRecord,
} from "../../lib/query/history";

export function getHistoryRouteState(matches: MatchHistoryRecord[]) {
  return buildHistoryRouteState(matches);
}
