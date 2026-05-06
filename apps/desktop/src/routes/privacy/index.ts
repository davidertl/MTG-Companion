import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";
import { describeNetworkPosture } from "../../lib/network/privacy";

export function buildPrivacyRouteState(settings: PrivacySettings) {
  const modeLabel = describeNetworkPosture(settings);
  return {
    title: "Privacy Center",
    telemetryEnabled: settings.telemetryEnabled,
    syncEnabled: settings.syncEnabled,
    allowedPurposes: [...settings.allowedPurposes],
    modeLabel,
    networkPosture: modeLabel,
  };
}

export const buildPrivacyRoute = buildPrivacyRouteState;
