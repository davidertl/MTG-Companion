import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";
import {
  buildCardDbStatusView,
  type CardDbStatusView,
} from "../history/index";
import type { RustCardDbStatus } from "../../lib/tauri/commands";

export interface SettingsExtras {
  /** Local, offline analysis toggle (persisted client-side). Defaults to on. */
  analysisEnabled?: boolean;
  /** Card DB status for the settings display; `null` while unknown. */
  cardDb?: Pick<RustCardDbStatus, "cardDbExists" | "cardCount" | "withArenaIdCount"> | null;
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
    networkPurposes: [...settings.allowedPurposes],
    offlineCapable: true,
    settingsFileName: "mancutg-arenac-settings.json",
    actions: [
      "Show settings",
      "Set consent",
      "Reset settings",
      "Wipe local data",
    ],
  };
}

export type SettingsState = ReturnType<typeof buildSettingsState>;
