import { describe, expect, it, vi } from "vitest";

import { openMainOverwolfWindow } from "../src/setup-window";

describe("openMainOverwolfWindow", () => {
  it("obtains and restores main window", () => {
    const restore = vi.fn((_target: string, callback?: (result: { success: boolean }) => void) => {
      callback?.({ success: true });
    });
    const obtainDeclaredWindow = vi.fn(
      (
        _name: string,
        callback: (result: {
          success: boolean;
          status?: string;
          window?: { id: string; name: string };
        }) => void,
      ) => {
        callback({ success: true, window: { id: "main-id", name: "main" } });
      },
    );
    vi.stubGlobal("overwolf", { windows: { obtainDeclaredWindow, restore } });

    const setError = vi.fn();
    openMainOverwolfWindow(setError);

    expect(obtainDeclaredWindow).toHaveBeenCalledWith("main", expect.any(Function));
    expect(restore).toHaveBeenCalledWith("main-id", expect.any(Function));
    expect(setError).not.toHaveBeenCalled();
  });

  it("surfaces obtain failure", () => {
    const restore = vi.fn();
    const obtainDeclaredWindow = vi.fn(
      (
        _name: string,
        callback: (result: {
          success: boolean;
          status?: string;
          window?: { id: string; name: string };
        }) => void,
      ) => {
        callback({ success: false, status: "no-window" });
      },
    );
    vi.stubGlobal("overwolf", { windows: { obtainDeclaredWindow, restore } });

    const setError = vi.fn();
    openMainOverwolfWindow(setError);

    expect(restore).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("Failed to obtain main window: no-window");
  });
});
