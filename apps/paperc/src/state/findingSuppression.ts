/**
 * Client-side referee-only suppression (plan 2026-07-06-001 W4.2).
 *
 * The backend is the enforcement authority for finding visibility (W3.3): a
 * player's read simply never contains referee-only findings. This module is the
 * *cosmetic second layer* on the player's own device — when the game a player is
 * logging is bound to a tournament in `referee-only` mode, the logging UI shows
 * a persistent "analysis routed to referee" notice and renders ZERO findings,
 * even if finding data happens to be present in local state.
 *
 * Pure and transport-agnostic so it is trivially unit-testable.
 */

import type {
  AnalysisFinding,
  FindingVisibilityMode,
} from "../../../../packages/shared-schema/src/index";

export const REFEREE_ONLY_NOTICE =
  "Analysis routed to referee — findings are hidden on this device during referee-only play.";

export interface LocalFindingsView {
  /** True when the bound tournament routes all analysis to the referee. */
  refereeOnly: boolean;
  /** Persistent banner text to show while referee-only; null otherwise. */
  notice: string | null;
  /** Findings safe to render locally — always empty under referee-only mode. */
  findings: AnalysisFinding[];
}

/**
 * Resolves what a player's logging UI may show. Under `referee-only` mode the
 * result is unconditionally empty (with the routing notice), regardless of how
 * many findings are supplied — that is the whole point of the suppression.
 * Under `players` mode (or when no tournament is bound / mode is undefined),
 * the findings pass through unchanged.
 */
export function buildLocalFindingsView(
  findings: readonly AnalysisFinding[],
  mode: FindingVisibilityMode | undefined,
): LocalFindingsView {
  const refereeOnly = mode === "referee-only";
  return {
    refereeOnly,
    notice: refereeOnly ? REFEREE_ONLY_NOTICE : null,
    findings: refereeOnly ? [] : [...findings],
  };
}
