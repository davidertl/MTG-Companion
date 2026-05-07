import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

describe("overwolf build smoke outputs", () => {
  it("expects dist html entrypoints after vite build", () => {
    const distDir = path.resolve("apps/overwolf/dist");
    expect(existsSync(path.join(distDir, "main.html"))).toBe(true);
    expect(existsSync(path.join(distDir, "setup.html"))).toBe(true);
  });
});
