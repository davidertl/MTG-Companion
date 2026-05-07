import type { PrivacySettings } from "../../../../../packages/shared-schema/src/index";
import { describeNetworkPosture } from "../../lib/network/privacy";

export function buildPrivacyRouteState(settings: PrivacySettings) {
  const modeLabel = describeNetworkPosture(settings);
  return {
    title: "Privacy Center",
    telemetryEnabled: settings.telemetryEnabled,
    syncEnabled: settings.syncEnabled,
    archidektEnabled: settings.allowedPurposes.includes("archidekt"),
    allowedPurposes: [...settings.allowedPurposes],
    modeLabel,
    networkPosture: modeLabel,
    localDataStays: [
      "Raw logs and raw chunks stay on device by default.",
      "Match history, collection, inventory, draft data, and diagnostics remain local until you export or opt in to sync-like features.",
    ],
    outboundDataUses: [
      "Sync is optional and disabled by default.",
      "Telemetry is optional and disabled by default.",
      "Archidekt is only contacted when explicitly enabled.",
    ],
  };
}

export const buildPrivacyRoute = buildPrivacyRouteState;
