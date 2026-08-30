import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";
import {
  buildCardDbStatusView,
  type CardDbStatusView,
} from "../history/index";
import type { RustCardDbStatus, RustSyncOutcome } from "../../lib/tauri/commands";

/** Result of the last `sync_now` run, as surfaced in Settings. */
export type SyncOutcomeView = Pick<
  RustSyncOutcome,
  "attempted" | "eventsSynced" | "pendingRemaining"
> & { lastError?: string | null };

export type SyncStatusState = ReturnType<typeof buildSyncStatus>;

/**
 * Human-readable sync status. `state` is one of:
 * - `disabled` — sync consent is off (hard-gated; the "Sync now" trigger is
 *   disabled and no network call is ever made);
 * - `idle` — consent on, no sync run yet this session;
 * - `ok` — last run succeeded;
 * - `error` — last run reported an error (events stay queued for retry).
 */
export function buildSyncStatus(
  syncEnabled: boolean,
  outcome: SyncOutcomeView | null | undefined,
) {
  if (!syncEnabled) {
    return {
      state: "disabled" as const,
      message: "Sync is off. Enable sync consent to upload events to the backend.",
      pendingRemaining: 0,
    };
  }
  if (!outcome || !outcome.attempted) {
    return {
      state: "idle" as const,
      message: "Sync ready. No sync has run yet.",
      pendingRemaining: outcome?.pendingRemaining ?? 0,
    };
  }
  if (outcome.lastError) {
    return {
      state: "error" as const,
      message: `Last sync error: ${outcome.lastError}`,
      pendingRemaining: outcome.pendingRemaining,
    };
  }
  return {
    state: "ok" as const,
    message: `Synced ${outcome.eventsSynced} event(s); ${outcome.pendingRemaining} pending.`,
    pendingRemaining: outcome.pendingRemaining,
  };
}

export interface SettingsExtras {
  /** Local, offline analysis toggle (persisted client-side). Defaults to on. */
  analysisEnabled?: boolean;
  /** Card DB status for the settings display; `null` while unknown. */
  cardDb?: Pick<RustCardDbStatus, "cardDbExists" | "cardCount" | "withArenaIdCount"> | null;
  /** Result of the last `sync_now` run; `null`/absent while none has run. */
  syncOutcome?: SyncOutcomeView | null;
}

export function buildSettingsState(settings: PrivacySettings, extras: SettingsExtras = {}) {
  const cardDb: CardDbStatusView = buildCardDbStatusView(extras.cardDb ?? null);
  return {
    title: "Settings",
    syncEnabled: settings.syncEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    archidektEnabled: settings.allowedPurposes.includes("archidekt"),
    analysisEnabled: extras.analysisEnabled ?? true,
    cardDb,
    sync: {
      /** The "Sync now" trigger is only actionable when consent is on. */
      canSyncNow: settings.syncEnabled,
      triggerLabel: "Sync now",
      status: buildSyncStatus(settings.syncEnabled, extras.syncOutcome ?? null),
    },
    networkPurposes: [...settings.allowedPurposes],
    offlineCapable: true,
    settingsFileName: "mancutg-arenac-settings.json",
    actions: [
      "Show settings",
      "Set consent",
      "Sync now",
      "Reset settings",
      "Wipe local data",
    ],
  };
}

export type SettingsState = ReturnType<typeof buildSettingsState>;
