import { z } from "zod";

export type NetworkPurpose = "updates" | "sync" | "telemetry" | "archidekt";

export const privacySettingsSchema = z.object({
  telemetryEnabled: z.boolean(),
  syncEnabled: z.boolean(),
  allowedPurposes: z.array(z.enum(["updates", "sync", "telemetry", "archidekt"])),
});

export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export function createPrivacySettings(input?: Partial<PrivacySettings>): PrivacySettings {
  return privacySettingsSchema.parse({
    telemetryEnabled: input?.telemetryEnabled ?? false,
    syncEnabled: input?.syncEnabled ?? false,
    allowedPurposes: input?.allowedPurposes ?? ["updates"],
  });
}

export function canSendNetworkRequest(settings: PrivacySettings, purpose: NetworkPurpose): boolean {
  if (!settings.allowedPurposes.includes(purpose)) {
    return false;
  }

  if (purpose === "telemetry") {
    return settings.telemetryEnabled;
  }

  if (purpose === "sync") {
    return settings.syncEnabled;
  }

  if (purpose === "archidekt") {
    return true;
  }

  return true;
}

export function describeNetworkPosture(settings: PrivacySettings): string {
  const activePurposes = settings.allowedPurposes.filter((purpose) =>
    canSendNetworkRequest(settings, purpose),
  );

  if (activePurposes.length === 0 || activePurposes.every((purpose) => purpose === "updates")) {
    return "Offline-only mode";
  }

  return `Network enabled for: ${activePurposes.join(", ")}`;
}
