import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ArenacApi, DEFAULT_ARENAC_API_BASE } from "@arenac/lib/api/client";

declare const overwolf: {
  windows: {
    obtainDeclaredWindow(
      name: string,
      callback: (result: { success: boolean; status?: string }) => void,
    ): void;
  };
} | undefined;

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
    try {
      const api = new ArenacApi(serviceUrl);
      await api.health();
      if (logPath.trim()) {
        await api.configure({ logPath: logPath.trim() });
      }
      if (typeof overwolf !== "undefined") {
        overwolf.windows.obtainDeclaredWindow("main", (res) => {
          if (!res.success) {
            setError(res.status ?? "Failed to open main window");
          }
        });
      } else {
        window.open("main.html", "_blank");
      }
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
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={() => void saveAndOpenMain()}>
          Save &amp; open main window
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#5c6b86" }}>
        Run the Rust sidecar first: place <code>mancutg-arenac.exe</code> next to this package and launch{" "}
        <code>mancutg-arenac.exe serve</code> (see docs/release/overwolf-install.md).
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(<SetupApp />);
