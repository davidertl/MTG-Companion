import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ArenacApi, DEFAULT_ARENAC_API_BASE } from "../../desktop/src/lib/api/client";

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

type ProcessManagerLike = {
  launchProcess?: (options: {
    executable: string;
    args?: string[];
  }) => Promise<{ success?: boolean; status?: string }> | { success?: boolean; status?: string };
  run?: (executable: string, args?: string[]) => Promise<unknown> | unknown;
};

const SIDECAR_COMMAND = "mancutg-arenac.exe serve --port 17890";

const wait = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));

export async function probeHealth(serviceUrl: string): Promise<boolean> {
  const api = new ArenacApi(serviceUrl);
  try {
    const health = await api.health();
    return health.ok;
  } catch {
    return false;
  }
}

function getProcessManagerPlugin(): ProcessManagerLike | null {
  const candidate = (
    globalThis as unknown as { processManager?: ProcessManagerLike }
  ).processManager;
  if (candidate?.launchProcess || candidate?.run) {
    return candidate;
  }
  return null;
}

export async function ensureArenaServiceRunning(serviceUrl: string): Promise<{
  started: boolean;
  usedManualFallback: boolean;
  reason?: string;
}> {
  if (await probeHealth(serviceUrl)) {
    return { started: true, usedManualFallback: false };
  }

  const plugin = getProcessManagerPlugin();
  if (!plugin) {
    return {
      started: false,
      usedManualFallback: true,
      reason: "Process Manager plugin unavailable.",
    };
  }

  try {
    if (plugin.launchProcess) {
      const result = await plugin.launchProcess({
        executable: "bin/mancutg-arenac.exe",
        args: ["serve", "--port", "17890"],
      });
      if (result && result.success === false) {
        return {
          started: false,
          usedManualFallback: true,
          reason: `Sidecar launch failed: ${result.status ?? "unknown error"}`,
        };
      }
    } else if (plugin.run) {
      await plugin.run("bin/mancutg-arenac.exe", ["serve", "--port", "17890"]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      started: false,
      usedManualFallback: true,
      reason: `Sidecar launch failed: ${message}`,
    };
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await probeHealth(serviceUrl)) {
      return { started: true, usedManualFallback: false };
    }
    await wait(1000);
  }

  return {
    started: false,
    usedManualFallback: true,
    reason: "Sidecar did not become healthy within 10 seconds.",
  };
}

export function openMainOverwolfWindow(setError: (message: string) => void): void {
  if (typeof overwolf === "undefined") {
    if (typeof window !== "undefined") {
      window.open("main.html", "_blank");
    }
    return;
  }
  overwolf.windows.obtainDeclaredWindow("main", (res) => {
    if (!res.success) {
      setError(`Failed to obtain main window: ${res.status ?? "unknown error"}`);
      return;
    }
    const target = res.window?.id ?? "main";
    overwolf.windows.restore(target, (restoreResult) => {
      if (!restoreResult.success) {
        setError(`Failed to restore main window: ${restoreResult.status ?? "unknown error"}`);
      }
    });
  });
}

const panel: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0f17",
  color: "#dce6f4",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  padding: 24,
  display: "grid",
  gap: 16,
};

const btn: React.CSSProperties = {
  border: "1px solid #35507a",
  borderRadius: 12,
  background: "#4f8cff",
  color: "#f7f9fc",
  padding: "12px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

function SetupApp() {
  const [logPath, setLogPath] = useState("");
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_ARENAC_API_BASE);
  const [status, setStatus] = useState<string>("Detecting Player.log…");
  const [error, setError] = useState<string | null>(null);
  const [manualFallback, setManualFallback] = useState<string | null>(null);

  useEffect(() => {
    const api = new ArenacApi(serviceUrl);
    void (async () => {
      try {
        const d = await api.detectPlayerLog();
        setLogPath(d.playerLogPath ?? "");
        setStatus(
          d.playerLogPath
            ? "Detected default Player.log path. Enable Detailed Logs in MTG Arena if imports look empty."
            : "Could not auto-detect Player.log. Enter the path manually.",
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Companion service not reachable. Start mancutg-arenac.exe serve (or cargo run -p mancutg-arenac -- serve).");
      }
    })();
  }, [serviceUrl]);

  const saveAndOpenMain = async () => {
    setError(null);
    setManualFallback(null);
    try {
      const service = await ensureArenaServiceRunning(serviceUrl);
      if (!service.started) {
        setManualFallback(SIDECAR_COMMAND);
        if (service.reason) {
          setError(service.reason);
        }
        return;
      }

      const api = new ArenacApi(serviceUrl);
      if (logPath.trim()) {
        await api.configure({ logPath: logPath.trim() });
      }
      openMainOverwolfWindow(setError);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={panel}>
      <h1 style={{ margin: 0, fontSize: 22 }}>MancuTG-ArenaC setup</h1>
      <p style={{ margin: 0, color: "#8ea0bc", lineHeight: 1.5 }}>{status}</p>
      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Companion service URL
        <input
          value={serviceUrl}
          onChange={(e) => setServiceUrl(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #24324a",
            background: "#0d121b",
            color: "#f7f9fc",
          }}
        />
      </label>
      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Player.log path (Windows)
        <input
          value={logPath}
          onChange={(e) => setLogPath(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #24324a",
            background: "#0d121b",
            color: "#f7f9fc",
          }}
        />
      </label>
      {error ? (
        <div style={{ color: "#f7a8b8", fontSize: 14 }}>{error}</div>
      ) : null}
      {manualFallback ? (
        <div style={{ color: "#f7f0a8", fontSize: 14 }}>
          Local ArenaC service is not running. Start this command:
          <div style={{ marginTop: 6 }}>
            <code>{manualFallback}</code>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={() => void saveAndOpenMain()}>
          Save &amp; open main window
        </button>
        {manualFallback ? (
          <button type="button" style={btn} onClick={() => void saveAndOpenMain()}>
            Retry service check
          </button>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#5c6b86" }}>
        Run the Rust sidecar first: place <code>mancutg-arenac.exe</code> next to this package and launch{" "}
        <code>mancutg-arenac.exe serve --port 17890</code> (see docs/release/overwolf-install.md).
      </p>
    </div>
  );
}

if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("missing #root");
  }
  createRoot(root).render(<SetupApp />);
}
