import {
  mediaCaptureSessionSchema,
  type MediaCaptureSession,
} from "../../../../packages/shared-schema/src/index";

export function buildCaptureSession(input: MediaCaptureSession): MediaCaptureSession {
  return mediaCaptureSessionSchema.parse(input);
}
