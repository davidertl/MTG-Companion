import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const TOPIC_WINDOWS = [
  "imports",
  "collection",
  "inventory",
  "draft",
  "decks",
  "diagnostics",
  "privacy",
  "settings",
] as const;

describe("overwolf build smoke outputs", () => {
  it("expects dist html entrypoints after vite build", () => {
    const distDir = path.resolve("apps/overwolf/dist");
    expect(existsSync(path.join(distDir, "main.html"))).toBe(true);
    expect(existsSync(path.join(distDir, "setup.html"))).toBe(true);
    for (const name of TOPIC_WINDOWS) {
      expect(existsSync(path.join(distDir, `${name}.html`))).toBe(true);
    }
  });

  it("starts on the main window so Overwolf opens the dashboard first", () => {
    const manifestPath = path.resolve("apps/overwolf/public/manifest.json");
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      data?: { start_window?: string };
    };
    expect(raw.data?.start_window).toBe("main");
  });

  it("declares one Overwolf window per top-level topic in the side nav", () => {
    const manifestPath = path.resolve("apps/overwolf/public/manifest.json");
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      data?: { windows?: Record<string, { file?: string }> };
    };
    const windows = raw.data?.windows ?? {};
    expect(windows.main?.file).toBe("main.html");
    expect(windows.setup?.file).toBe("setup.html");
    for (const name of TOPIC_WINDOWS) {
      expect(windows[name]?.file).toBe(`${name}.html`);
    }
  });
});
