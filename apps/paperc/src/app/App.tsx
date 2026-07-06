import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  AnalysisFinding,
  FindingVisibilityMode,
  GameAction,
  TournamentContext,
} from "../../../../packages/shared-schema/src/index";
import {
  buildGameEventBatch,
  createGameLogState,
  gameLogReducer,
  projectGameLog,
  type GameLogState,
  type PaperGameSetup,
} from "../state/gameLog";
import {
  PALETTE,
  PHASES,
  activateAbility,
  castSpell,
  declareAttackers,
  declareBlockers,
  gameEnded,
  gameStarted,
  lifeChanged,
  manualNote,
  phaseChanged,
  playLand,
  triggerNoted,
  turnBegan,
  type PaletteKind,
} from "../state/actions";
import { cardIndexInfo } from "../state/cardIndex";
import {
  GAME_LOG_STORAGE_KEY,
  SETUP_STORAGE_KEY,
  getDefaultStore,
  loadJson,
  saveJson,
} from "../state/persistence";
import { buildLocalFindingsView } from "../state/findingSuppression";
import { Outbox, browserFetch } from "../sync/outbox";
import { Panel, PillButton, TextField, Toggle, theme } from "./components";
import { CardNameInput } from "./CardNameInput";
import { RefereeView } from "./RefereeView";

type AppMode = "log" | "referee";

function ModeSwitch(props: { mode: AppMode; onChange: (mode: AppMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <PillButton
        label="Log a game"
        variant={props.mode === "log" ? "accent" : "default"}
        onClick={() => props.onChange("log")}
      />
      <PillButton
        label="Referee view"
        variant={props.mode === "referee" ? "accent" : "default"}
        onClick={() => props.onChange("referee")}
      />
    </div>
  );
}

const store = getDefaultStore();

function newId(prefix: string): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  const rand =
    cryptoObj && "randomUUID" in cryptoObj
      ? cryptoObj.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

function localTournamentContext(matchId: string, tableId: string): TournamentContext {
  return {
    tournamentId: "local",
    roundId: "local",
    tableId,
    matchId,
    gameKey: "mtg-paper",
  };
}

type SetupForm = {
  player1: string;
  player2: string;
  format: string;
  tournamentId: string;
  roundId: string;
  tableId: string;
  refereeOnly: boolean;
};

const DEFAULT_SETUP_FORM: SetupForm = {
  player1: "Player 1",
  player2: "Player 2",
  format: "commander",
  tournamentId: "",
  roundId: "",
  tableId: "",
  refereeOnly: false,
};

function buildSetup(form: SetupForm): PaperGameSetup {
  const sessionId = newId("paper-session");
  const matchId = newId("match");
  const useTournament = form.tournamentId.trim().length > 0;
  const tableId = form.tableId.trim() || newId("table");
  const tournament: TournamentContext = useTournament
    ? {
        tournamentId: form.tournamentId.trim(),
        roundId: form.roundId.trim() || "round-1",
        tableId,
        matchId,
        gameKey: "mtg-paper",
      }
    : localTournamentContext(matchId, tableId);
  // Referee-only routing only applies to a real bound tournament; a casual local
  // game leaves it undefined (treated as `players`).
  const findingVisibilityMode: FindingVisibilityMode | undefined = useTournament
    ? form.refereeOnly
      ? "referee-only"
      : "players"
    : undefined;
  return {
    sourceSessionId: sessionId,
    captureSessionId: newId("capture"),
    cameraId: "manual",
    platform: "paperc-web",
    clientVersion: "0.1.0",
    startedAt: new Date().toISOString(),
    format: form.format.trim() || "casual",
    players: { player1: form.player1.trim() || "Player 1", player2: form.player2.trim() || "Player 2" },
    tournament,
    findingVisibilityMode,
  };
}

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("log");
  const [setup, setSetup] = useState<PaperGameSetup | null>(() =>
    loadJson<PaperGameSetup>(store, SETUP_STORAGE_KEY),
  );
  const [form, setForm] = useState<SetupForm>(DEFAULT_SETUP_FORM);
  const [log, dispatch] = useReducer(
    gameLogReducer,
    undefined,
    () =>
      loadJson<GameLogState>(store, GAME_LOG_STORAGE_KEY) ??
      createGameLogState("player1"),
  );
  const [cardName, setCardName] = useState("");
  const [lifeDelta, setLifeDelta] = useState("-1");
  const [noteText, setNoteText] = useState("");
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [endpoint, setEndpoint] = useState("http://localhost:8787");

  const outboxRef = useRef<Outbox | null>(null);
  const nextSeqRef = useRef(0);

  const getOutbox = useCallback(() => {
    if (!outboxRef.current) {
      outboxRef.current = new Outbox({ endpoint, fetchFn: browserFetch, store });
    }
    return outboxRef.current;
  }, [endpoint]);

  // Persist log + setup on every change (offline-first durability).
  useEffect(() => {
    saveJson(store, GAME_LOG_STORAGE_KEY, log);
  }, [log]);
  useEffect(() => {
    if (setup) {
      saveJson(store, SETUP_STORAGE_KEY, setup);
    }
  }, [setup]);

  const projection = useMemo(() => projectGameLog(log), [log]);

  const activePlayerName = useMemo(() => {
    if (!setup) {
      return log.activePlayer;
    }
    return log.activePlayer === "player2" ? setup.players.player2 : setup.players.player1;
  }, [setup, log.activePlayer]);

  const logAction = useCallback((action: GameAction) => {
    dispatch({
      type: "log",
      action,
      eventId: newId("paperc-obs"),
      occurredAt: new Date().toISOString(),
    });
  }, []);

  const undo = useCallback((targetEventId: string) => {
    dispatch({
      type: "undo",
      targetEventId,
      eventId: newId("paperc-undo"),
      occurredAt: new Date().toISOString(),
      reason: "manual undo",
    });
  }, []);

  const startGame = useCallback(() => {
    const nextSetup = buildSetup(form);
    setSetup(nextSetup);
    saveJson(store, SETUP_STORAGE_KEY, nextSetup);
    const fresh = createGameLogState("player1");
    dispatch({ type: "hydrate", state: fresh });
    // Seed the game with a gameStarted + turn 1 marker.
    dispatch({
      type: "log",
      action: gameStarted(["player1", "player2"], "player1"),
      eventId: newId("paperc-obs"),
      occurredAt: new Date().toISOString(),
    });
    dispatch({
      type: "log",
      action: turnBegan("player1", 1),
      eventId: newId("paperc-obs"),
      occurredAt: new Date().toISOString(),
    });
  }, [form]);

  const handlePalette = useCallback(
    (kind: PaletteKind) => {
      const actor = log.activePlayer;
      switch (kind) {
        case "playLand":
          logAction(playLand(actor, cardName));
          setCardName("");
          break;
        case "castSpell":
          logAction(castSpell(actor, cardName));
          setCardName("");
          break;
        case "activateAbility":
          logAction(activateAbility(actor, cardName));
          setCardName("");
          break;
        case "declareAttackers":
          logAction(declareAttackers(actor, cardName ? [cardName] : []));
          setCardName("");
          break;
        case "declareBlockers":
          logAction(declareBlockers(actor, cardName ? [cardName] : []));
          setCardName("");
          break;
        case "lifeChange": {
          const delta = Number.parseInt(lifeDelta, 10);
          logAction(lifeChanged(actor, Number.isFinite(delta) ? delta : 0));
          break;
        }
        case "triggerNoted":
          logAction(triggerNoted(actor, noteText || undefined));
          setNoteText("");
          break;
        case "manualNote":
          if (noteText.trim()) {
            logAction(manualNote(actor, noteText.trim()));
            setNoteText("");
          }
          break;
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    },
    [log.activePlayer, cardName, lifeDelta, noteText, logAction],
  );

  const nextTurn = useCallback(() => {
    const nextPlayer = log.activePlayer === "player1" ? "player2" : "player1";
    logAction(turnBegan(nextPlayer, log.turnNumber + 1));
  }, [log.activePlayer, log.turnNumber, logAction]);

  const setPhase = useCallback(
    (phase: string) => {
      logAction(phaseChanged(log.activePlayer, phase));
    },
    [log.activePlayer, logAction],
  );

  const endGame = useCallback(() => {
    logAction(gameEnded(log.activePlayer, undefined, "unknown"));
  }, [log.activePlayer, logAction]);

  const queueForSync = useCallback(() => {
    if (!setup) {
      return;
    }
    const entries = log.entries.slice(nextSeqRef.current);
    if (entries.length === 0) {
      setSyncStatus("Nothing new to queue.");
      return;
    }
    const batch = buildGameEventBatch(entries, setup, newId("batch"));
    getOutbox().enqueue(batch);
    nextSeqRef.current = log.entries.length;
    setSyncStatus(`Queued ${entries.length} event(s). Pending batches: ${getOutbox().pendingCount()}.`);
  }, [setup, log.entries, getOutbox]);

  const flushSync = useCallback(async () => {
    try {
      const summary = await getOutbox().flush();
      setSyncStatus(
        `Flush: ${summary.sent} sent, ${summary.failed} failed, ${summary.remaining} pending.`,
      );
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : String(error));
    }
  }, [getOutbox]);

  const info = cardIndexInfo();

  const pageStyle = {
    minHeight: "100vh",
    background: theme.bg,
    color: theme.text,
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    padding: 16,
    display: "grid",
    gap: 16,
    maxWidth: 760,
    margin: "0 auto",
  } as const;

  if (appMode === "referee") {
    return (
      <div style={pageStyle}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>MancuTG-PaperC</h1>
          <ModeSwitch mode={appMode} onChange={setAppMode} />
        </header>
        <RefereeView />
      </div>
    );
  }

  if (!setup) {
    return (
      <div style={pageStyle}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>MancuTG-PaperC</h1>
          <ModeSwitch mode={appMode} onChange={setAppMode} />
        </header>
        <Panel title="New game" subtitle="Log a physical match move-by-move.">
          <TextField label="Player 1" value={form.player1} onChange={(v) => setForm({ ...form, player1: v })} />
          <TextField label="Player 2" value={form.player2} onChange={(v) => setForm({ ...form, player2: v })} />
          <TextField label="Format" value={form.format} onChange={(v) => setForm({ ...form, format: v })} />
          <TextField
            label="Tournament id (optional)"
            value={form.tournamentId}
            onChange={(v) => setForm({ ...form, tournamentId: v })}
            placeholder="leave blank for a casual game"
          />
          <TextField label="Round (optional)" value={form.roundId} onChange={(v) => setForm({ ...form, roundId: v })} />
          <TextField label="Table (optional)" value={form.tableId} onChange={(v) => setForm({ ...form, tableId: v })} />
          {form.tournamentId.trim().length > 0 ? (
            <Toggle
              label="Referee-only analysis"
              hint="Findings route to the referee; this device shows none."
              checked={form.refereeOnly}
              onChange={(checked) => setForm({ ...form, refereeOnly: checked })}
            />
          ) : null}
          <PillButton label="Start game" variant="accent" onClick={startGame} />
        </Panel>
        <p style={{ color: theme.textDim, fontSize: 12, margin: 0 }}>
          Card index: {info.count} names ({info.source}). Offline-first — no network needed to log.
        </p>
      </div>
    );
  }

  // PaperC does not compute findings locally yet; when a synced tournament in
  // referee-only mode later surfaces findings here, this view guarantees the
  // player device shows none (cosmetic layer over the backend's enforcement).
  const localFindings: AnalysisFinding[] = [];
  const findingsView = buildLocalFindingsView(localFindings, setup.findingVisibilityMode);
  const boundToTournament = setup.tournament.tournamentId !== "local";

  return (
    <div style={pageStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>MancuTG-PaperC</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ModeSwitch mode={appMode} onChange={setAppMode} />
          <PillButton label="End & new game" variant="danger" onClick={() => setSetup(null)} />
        </div>
      </header>

      <Panel
        title={`Turn ${log.turnNumber} — ${activePlayerName}`}
        subtitle={`Phase: ${log.phase} · ${setup.players.player1} vs ${setup.players.player2} · ${setup.format}`}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PHASES.map((phase) => (
            <PillButton
              key={phase}
              label={phase}
              variant={phase === log.phase ? "accent" : "default"}
              onClick={() => setPhase(phase)}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PillButton label="Next turn ▸" variant="accent" onClick={nextTurn} />
          <PillButton label="Game ended" onClick={endGame} />
        </div>
      </Panel>

      <Panel title="Action palette" subtitle="Each action logs a typed event.">
        <CardNameInput value={cardName} onChange={setCardName} placeholder="Card name (for card actions)…" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: theme.textDim, fontSize: 13 }}>Life Δ</span>
          <input
            value={lifeDelta}
            onChange={(event) => setLifeDelta(event.target.value)}
            aria-label="Life delta"
            style={{
              width: 64,
              background: "#0e1521",
              border: `1px solid ${theme.panelBorder}`,
              borderRadius: 10,
              color: theme.text,
              padding: "8px 10px",
              fontSize: 14,
            }}
          />
          <input
            value={noteText}
            placeholder="Trigger / note text…"
            aria-label="Note text"
            onChange={(event) => setNoteText(event.target.value)}
            style={{
              flex: 1,
              background: "#0e1521",
              border: `1px solid ${theme.panelBorder}`,
              borderRadius: 10,
              color: theme.text,
              padding: "8px 10px",
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PALETTE.map((entry) => (
            <PillButton key={entry.kind} label={entry.label} onClick={() => handlePalette(entry.kind)} />
          ))}
        </div>
      </Panel>

      {boundToTournament ? (
        <Panel
          title="Analysis"
          subtitle={findingsView.refereeOnly ? "Referee-only tournament." : "Findings for this game."}
        >
          {findingsView.refereeOnly ? (
            <p
              role="status"
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${theme.panelBorder}`,
                background: "#0e1521",
                color: theme.textDim,
                fontSize: 13,
              }}
            >
              {findingsView.notice}
            </p>
          ) : findingsView.findings.length === 0 ? (
            <p style={{ color: theme.textDim, fontSize: 13, margin: 0 }}>
              No findings for this game yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {findingsView.findings.map((finding) => (
                <li key={finding.findingId} style={{ fontSize: 13 }}>
                  T{finding.turnNumber} · {finding.severity} · {finding.description}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel title="Sync" subtitle="Offline queue; flush posts batches to the backend.">
        <TextField label="Backend endpoint" value={endpoint} onChange={setEndpoint} />
        <div style={{ display: "flex", gap: 8 }}>
          <PillButton label="Queue new events" onClick={queueForSync} />
          <PillButton label="Flush outbox" variant="accent" onClick={() => void flushSync()} />
        </div>
        {syncStatus ? (
          <p style={{ color: theme.textDim, fontSize: 12, margin: 0 }}>{syncStatus}</p>
        ) : null}
      </Panel>

      <Panel title={`Event review (${projection.review.length})`} subtitle="Undo appends a correction; nothing is deleted.">
        {projection.review.length === 0 ? (
          <p style={{ color: theme.textDim, fontSize: 13, margin: 0 }}>No actions logged yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {[...projection.review].reverse().map((row) => (
              <li
                key={row.eventId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${theme.panelBorder}`,
                  background: "#0e1521",
                  opacity: row.undone ? 0.45 : 1,
                  textDecoration: row.undone ? "line-through" : "none",
                }}
              >
                <span style={{ fontSize: 13 }}>
                  T{row.turnNumber} · {describeAction(row.action)}
                </span>
                {!row.undone ? (
                  <PillButton label="Undo" variant="danger" onClick={() => undo(row.eventId)} />
                ) : (
                  <span style={{ color: theme.textDim, fontSize: 12 }}>undone</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function describeAction(action: GameAction): string {
  switch (action.type) {
    case "playLand":
      return `Play land ${action.cardRef?.name ?? ""}`.trim();
    case "castSpell":
      return `Cast ${action.cardRef?.name ?? "spell"}`;
    case "activateAbility":
      return `Activate ${action.cardRef?.name ?? "ability"}`;
    case "declareAttackers":
      return `Attack (${action.attackers.length})`;
    case "declareBlockers":
      return `Block (${action.blockers.length})`;
    case "lifeChanged":
      return `Life ${action.playerRef} ${action.delta >= 0 ? "+" : ""}${action.delta}`;
    case "triggerNoted":
      return `Trigger: ${action.triggerText ?? "noted"}`;
    case "manualNote":
      return `Note: ${action.note}`;
    case "turnBegan":
      return `Turn ${action.turnNumber} begins (${action.actor})`;
    case "phaseChanged":
      return `Phase: ${action.phase}`;
    case "gameStarted":
      return "Game started";
    case "gameEnded":
      return "Game ended";
    default:
      return action.type;
  }
}
