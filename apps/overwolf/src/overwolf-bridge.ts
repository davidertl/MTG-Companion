/** Overwolf window helpers for the ArenaC package (main + per-topic windows). */

declare const overwolf: {
  windows: {
    obtainDeclaredWindow(
      name: string,
      callback: (result: {
        success: boolean;
        status?: string;
        window?: { id: string; name: string };
      }) => void,
    ): void;
    restore(
      windowIdOrName: string,
      callback?: (result: { success: boolean; status?: string }) => void,
    ): void;
  };
} | undefined;

/**
 * Obtain and restore a declared Overwolf window by its manifest name.
 *
 * Outside Overwolf (browser smoke tests / dev preview), falls back to `window.open`
 * so navigation still works for manual checks.
 */
export function openOverwolfWindow(
  name: string,
  onError: (message: string) => void,
): void {
  if (typeof overwolf === "undefined") {
    if (typeof window !== "undefined") {
      window.open(`${name}.html`, "_blank");
    }
    return;
  }
  overwolf.windows.obtainDeclaredWindow(name, (res) => {
    if (!res.success) {
      onError(`Failed to obtain window "${name}": ${res.status ?? "unknown error"}`);
      return;
    }
    const target = res.window?.id ?? name;
    overwolf.windows.restore(target, (restoreResult) => {
      if (!restoreResult.success) {
        onError(
          `Failed to restore window "${name}": ${restoreResult.status ?? "unknown error"}`,
        );
      }
    });
  });
}

export function openSetupOverwolfWindow(onError: (message: string) => void): void {
  openOverwolfWindow("setup", onError);
}
