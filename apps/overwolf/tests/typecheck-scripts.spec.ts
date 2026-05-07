import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("root typecheck split", () => {
  it("declares root + overwolf split scripts", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["typecheck:root"]).toBe("tsc --noEmit");
    expect(pkg.scripts["typecheck:overwolf"]).toContain("apps/overwolf");
    expect(pkg.scripts.typecheck).toContain("typecheck:root");
    expect(pkg.scripts.typecheck).toContain("typecheck:overwolf");
  });
});
