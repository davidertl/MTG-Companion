/**
 * Local persistence for the "analysis enabled" setting.
 *
 * Analysis is a purely local, offline feature, so — unlike the network consent
 * purposes which live in the Rust `PrivacySettings` — this preference is stored
 * client-side in the browser `localStorage`. It is on by default so a fresh
 * install can run analysis immediately; turning it off hides the "Run analysis"
 * affordance without touching any network posture.
 *
 * The read/write helpers accept an injectable storage so they stay pure and
 * testable without a real DOM.
 */

export const ANALYSIS_ENABLED_KEY = "mancutg.analysisEnabled";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): (ReadableStorage & WritableStorage) | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** Reads the persisted analysis-enabled flag; defaults to `true` when unset. */
export function readAnalysisEnabled(storage: ReadableStorage | null = defaultStorage()): boolean {
  if (!storage) {
    return true;
  }
  const raw = storage.getItem(ANALYSIS_ENABLED_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "true";
}

/** Persists the analysis-enabled flag. */
export function writeAnalysisEnabled(
  enabled: boolean,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage) {
    return;
  }
  storage.setItem(ANALYSIS_ENABLED_KEY, enabled ? "true" : "false");
}
