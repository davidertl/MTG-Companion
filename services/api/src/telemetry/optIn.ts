import {
  canSendNetworkRequest,
  telemetryEventSchema,
  type PrivacySettings,
  type TelemetryEvent,
} from "../../../../packages/shared-schema/src/index";

export interface TelemetryReceipt {
  accepted: boolean;
  reason: string;
  event?: TelemetryEvent;
}

export function recordTelemetryEvent(
  settings: PrivacySettings,
  event: unknown,
): TelemetryReceipt {
  if (!canSendNetworkRequest(settings, "telemetry")) {
    return {
      accepted: false,
      reason: "Telemetry is disabled by privacy settings.",
    };
  }

  return {
    accepted: true,
    reason: "Telemetry accepted.",
    event: telemetryEventSchema.parse(event),
  };
}

export const recordTelemetry = recordTelemetryEvent;
