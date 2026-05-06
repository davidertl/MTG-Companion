import { describe, expect, it } from "vitest";

import { resolveSessionMode } from "../src/auth/optionalMode";

describe("resolveSessionMode", () => {
  it("keeps the API in anonymous mode without a token", () => {
    expect(resolveSessionMode(undefined)).toBe("anonymous");
  });

  it("switches to authenticated mode when a token is present", () => {
    expect(resolveSessionMode("token-123")).toBe("authenticated");
  });
});
