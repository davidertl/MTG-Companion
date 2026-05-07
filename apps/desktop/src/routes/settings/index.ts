import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";

export function buildSettingsState(settings: PrivacySettings) {
  return {
    title: "Settings",
    syncEnabled: settings.syncEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    archidektEnabled: settings.allowedPurposes.includes("archidekt"),
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
