import { useMemo, useState } from "react";

import {
  PapercRuntimePipeline,
  ScriptedWebcamFrameSource,
  buildPapercEventBatchFromSnapshot,
  type PapercFrameInput,
  type PapercRuntimeConfig,
} from "../../../paperc/src/index";
import { exportPapercLogAsCsv, type PapercLiveLogRow } from "../lib/export/index";

type ZoneDraft = {
  zoneId: string;
  zoneKind: "battlefield" | "graveyard" | "library" | "exile" | "hand" | "command";
  ownerPlayerId?: string;
};

const panelStyle: React.CSSProperties = {
  background: "#0f1520",
  border: "1px solid #24324a",
  borderRadius: 16,
  padding: 16,
  display: "grid",
  gap: 12,
};

const inputStyle: React.CSSProperties = {
  background: "#0d121b",
  border: "1px solid #24324a",
  color: "#f7f9fc",
  borderRadius: 8,
  padding: "6px 10px",
};

function makeSyntheticFrames(zones: ZoneDraft[]): PapercFrameInput[] {
  if (zones.length === 0) return [];
  return [
    {
      frameNo: 1,
      frameTimeMs: 66,
      width: 1280,
      height: 720,
      rawDetections: [
        { zoneId: zones[0].zoneId, label: "island", confidence: 0.99, count: 1 },
        { zoneId: zones[0].zoneId, label: "lightning bolt", confidence: 0.98, count: 1 },
      ],
    },
    {
      frameNo: 2,
      frameTimeMs: 133,
      width: 1280,
      height: 720,
      rawDetections: [{ zoneId: zones[0].zoneId, label: "sol ring", confidence: 0.97, count: 1 }],
    },
  ];
}

export function PaperClientWorkbench() {
  const [backendUrl, setBackendUrl] = useState("http://127.0.0.1:8787");
  const [forwardToBackend, setForwardToBackend] = useState(false);
  const [videoSourceId, setVideoSourceId] = useState("webcam-0");
  const [cameraId, setCameraId] = useState("cam-a");
  const [fps, setFps] = useState(15);
  const [resolution, setResolution] = useState("1280x720");
  const [playerOneName, setPlayerOneName] = useState("Player 1");
  const [playerTwoName, setPlayerTwoName] = useState("Player 2");
  const [zones, setZones] = useState<ZoneDraft[]>([
    { zoneId: "p1-battlefield", zoneKind: "battlefield", ownerPlayerId: "p1" },
    { zoneId: "p1-graveyard", zoneKind: "graveyard", ownerPlayerId: "p1" },
    { zoneId: "p2-battlefield", zoneKind: "battlefield", ownerPlayerId: "p2" },
    { zoneId: "p2-graveyard", zoneKind: "graveyard", ownerPlayerId: "p2" },
  ]);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [recognized, setRecognized] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [logRows, setLogRows] = useState<PapercLiveLogRow[]>([]);

  const [width, height] = resolution.split("x").map((item) => Number(item));
  const config = useMemo<PapercRuntimeConfig>(
    () => ({
      captureSessionId: "paper-live-capture",
      sourceSessionId: "paper-live-session",
      streamId: "table-1",
      modelVersion: "paperc-baseline-v1",
      startedAt: new Date().toISOString(),
      tournament: {
        tournamentId: "local-testing",
        roundId: "round-1",
        tableId: "table-1",
        matchId: "match-1",
        gameKey: "mtg-paper",
      },
      video: {
        sourceId: videoSourceId,
        cameraId,
        fps,
        width: Number.isFinite(width) ? width : 1280,
        height: Number.isFinite(height) ? height : 720,
        rotateDeg: "0",
      },
      players: [
        { playerId: "p1", displayName: playerOneName, seatRef: "north" },
        { playerId: "p2", displayName: playerTwoName, seatRef: "south" },
      ],
      zones: zones.map((zone, idx) => ({
        ...zone,
        rect: { x: 0.05 + idx * 0.03, y: 0.1, width: 0.2, height: 0.2 },
      })),
    }),
    [cameraId, fps, height, playerOneName, playerTwoName, videoSourceId, width, zones],
  );

  async function runDetectionTick() {
    const frameSource = new ScriptedWebcamFrameSource(makeSyntheticFrames(zones));
    const pipeline = new PapercRuntimePipeline(config, ["Island", "Lightning Bolt", "Sol Ring"]);
    const snapshot = await pipeline.runOnce(frameSource);
    if (!snapshot) return;
    const batch = buildPapercEventBatchFromSnapshot(config, snapshot);
    const cards = snapshot.detections.map((item) => item.candidateName);
    setRecognized(cards);
    setLiveLog((existing) => {
      const next = [...existing];
      next.unshift(
        `${new Date().toISOString()} frame=${snapshot.frameNo} cards=${cards.join(", ") || "none"} events=${batch?.events.length ?? 0}`,
      );
      return next.slice(0, 50);
    });
    setLogRows((existing) => {
      const nextRows: PapercLiveLogRow[] = snapshot.detections.map((item) => ({
        timestamp: new Date().toISOString(),
        eventType: "paperc.observation.detected",
        player: item.zoneId.startsWith("p2-") ? playerTwoName : playerOneName,
        card: item.candidateName,
        zone: item.zoneId,
        confidence: item.confidence,
      }));
      return [...nextRows, ...existing].slice(0, 200);
    });
    setTickCount((count) => count + 1);

    if (forwardToBackend && batch) {
      try {
        await fetch(`${backendUrl.replace(/\/$/, "")}/events`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        });
        setLiveLog((existing) => {
          const next = [...existing];
          next.unshift(`${new Date().toISOString()} forwarded batch to backend /events`);
          return next.slice(0, 50);
        });
      } catch (error: unknown) {
        setLiveLog((existing) => {
          const next = [...existing];
          next.unshift(
            `${new Date().toISOString()} backend forwarding failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return next.slice(0, 50);
        });
      }
    }
  }

  return (
    <section style={{ margin: 16, display: "grid", gap: 16 }}>
      <h2 style={{ margin: 0, color: "#f7f9fc" }}>PaperC Operator Workbench</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <div style={panelStyle}>
          <strong>Settings</strong>
          <label>
            Backend URL
            <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={forwardToBackend}
              onChange={(e) => setForwardToBackend(e.target.checked)}
            />
            Forward live events to backend `/events`
          </label>
          <label>
            Video source
            <input value={videoSourceId} onChange={(e) => setVideoSourceId(e.target.value)} style={inputStyle} />
          </label>
          <label>
            Camera ID
            <input value={cameraId} onChange={(e) => setCameraId(e.target.value)} style={inputStyle} />
          </label>
          <label>
            FPS
            <input type="number" value={fps} onChange={(e) => setFps(Number(e.target.value) || 15)} style={inputStyle} />
          </label>
          <label>
            Resolution
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} style={inputStyle}>
              <option value="1280x720">1280x720</option>
              <option value="1920x1080">1920x1080</option>
              <option value="640x480">640x480</option>
            </select>
          </label>
        </div>

        <div style={panelStyle}>
          <strong>Players</strong>
          <label>
            Player 1 name
            <input value={playerOneName} onChange={(e) => setPlayerOneName(e.target.value)} style={inputStyle} />
          </label>
          <label>
            Player 2 name
            <input value={playerTwoName} onChange={(e) => setPlayerTwoName(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </div>

      <div style={{ ...panelStyle, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <strong>Zones</strong>
        {zones.map((zone, index) => (
          <div key={zone.zoneId} style={{ display: "flex", gap: 8 }}>
            <input
              value={zone.zoneId}
              onChange={(e) => {
                const next = [...zones];
                next[index] = { ...zone, zoneId: e.target.value };
                setZones(next);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={zone.zoneKind}
              onChange={(e) => {
                const next = [...zones];
                next[index] = { ...zone, zoneKind: e.target.value as ZoneDraft["zoneKind"] };
                setZones(next);
              }}
              style={inputStyle}
            >
              <option value="battlefield">battlefield</option>
              <option value="graveyard">graveyard</option>
              <option value="library">library</option>
              <option value="exile">exile</option>
              <option value="hand">hand</option>
              <option value="command">command</option>
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={() => setRunning((v) => !v)} style={inputStyle}>
          {running ? "Pause detection" : "Start detection"}
        </button>
        <button type="button" onClick={() => void runDetectionTick()} style={inputStyle}>
          Run detection tick
        </button>
        <button
          type="button"
          onClick={() => {
            const csv = exportPapercLogAsCsv(logRows);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "paperc-live-log.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={inputStyle}
        >
          Export live log CSV
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <div style={panelStyle}>
          <strong>Recognition overview</strong>
          <span>Ticks: {tickCount}</span>
          <span>Runtime: {running ? "running" : "idle"}</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {recognized.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
        <div style={panelStyle}>
          <strong>Live game log</strong>
          <div style={{ maxHeight: 240, overflow: "auto", display: "grid", gap: 6 }}>
            {liveLog.map((entry) => (
              <code key={entry} style={{ color: "#9ec5ff" }}>
                {entry}
              </code>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
