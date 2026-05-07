import { z } from "zod";

import {
  mediaCaptureSessionSchema,
  type MediaCaptureSession,
} from "../../../../packages/shared-schema/src/index";

export function buildCaptureSession(
  input: z.input<typeof mediaCaptureSessionSchema>,
): MediaCaptureSession {
  return mediaCaptureSessionSchema.parse(input);
}
