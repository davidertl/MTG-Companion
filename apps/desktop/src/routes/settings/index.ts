import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";

export function buildSettingsState(settings: PrivacySettings) {
  return {
    title: "Settings",
    syncEnabled: settings.syncEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    networkPurposes: [...settings.allowedPurposes],
    offlineCapable: true,
  };
}
