import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AnalysisFinding } from "../../../../packages/shared-schema/src/index";
import {
  createRefereeFeedState,
  orderedFeedItems,
  refereeFeedReducer,
  type FeedReview,
  type ReviewResolution,
} from "../state/refereeFeed";
import {
  REFEREE_SESSION_STORAGE_KEY,
  getDefaultStore,
  loadJson,
  saveJson,
} from "../state/persistence";
import {
  listFindings,
  reviewFinding,
  type RefereeApiConfig,
} from "../sync/refereeApi";
import { Panel, PillButton, TextField, theme } from "./components";

const store = getDefaultStore();

/** How often the feed re-polls the findings endpoint (spec: 5-10s). */
const POLL_INTERVAL_MS = 6_000;

type RefereeSession = {
  endpoint: string;
  token: string;
  tournamentId: string;
};

const SEVERITY_COLORS: Record<AnalysisFinding["severity"], string> = {
  "possible-violation": "#ff8080",
  warning: "#ffcf70",
  info: theme.textDim,
};

function loadSession(): RefereeSession {
  const saved = loadJson<RefereeSession>(store, REFEREE_SESSION_STORAGE_KEY);
  return {
    endpoint: saved?.endpoint ?? "http://localhost:8787",
    token: saved?.token ?? "",
    tournamentId: saved?.tournamentId ?? "",
  };
}

/**
 * Referee dashboard (plan 2026-07-06-001 W4.2).
 *
 * A referee pastes a bearer token, names a tournament, and connects. The view
 * then polls GET /tournaments/:id/findings every few seconds, merging each
 * batch into the transport-agnostic feed reducer (dedupe by findingId, severity
 * ordering). Acknowledge is a local marker; Confirm/Dismiss POST a review to the
 * backend and optimistically update the feed.
 */
export function RefereeView() {
  const initial = useMemo(loadSession, []);
  const [draft, setDraft] = useState<RefereeSession>(initial);
  const [session, setSession] = useState<RefereeSession | null>(null);
  const [state, dispatch] = useReducer(refereeFeedReducer, undefined, createRefereeFeedState);
  const [mode, setMode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // Keep a ref to the live session so the interval callback always polls the
  // current target without re-subscribing on every keystroke.
  const sessionRef = useRef<RefereeSession | null>(null);
  sessionRef.current = session;

  const apiConfig = useCallback(
    (target: RefereeSession): RefereeApiConfig => ({
      endpoint: target.endpoint,
      token: target.token,
    }),
    [],
  );

  const poll = useCallback(async () => {
    const target = sessionRef.current;
    if (!target) {
      return;
    }
    setPolling(true);
    try {
      const response = await listFindings(apiConfig(target), target.tournamentId);
      setMode(response.findingVisibilityMode);
      dispatch({
        type: "merge",
        findings: response.findings,
        at: new Date().toISOString(),
      });
    } catch (error) {
      dispatch({
        type: "pollError",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPolling(false);
    }
  }, [apiConfig]);

  const connect = useCallback(() => {
    if (!draft.token.trim() || !draft.tournamentId.trim()) {
      return;
    }
    const next: RefereeSession = {
      endpoint: draft.endpoint.trim() || "http://localhost:8787",
      token: draft.token.trim(),
      tournamentId: draft.tournamentId.trim(),
    };
    saveJson(store, REFEREE_SESSION_STORAGE_KEY, next);
    dispatch({ type: "reset" });
    setMode(null);
    setSession(next);
  }, [draft]);

  const disconnect = useCallback(() => {
    setSession(null);
    setMode(null);
    dispatch({ type: "reset" });
  }, []);

  // Polling loop: immediate poll on connect, then every POLL_INTERVAL_MS.
  useEffect(() => {
    if (!session) {
      return;
    }
    void poll();
    const handle = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [session, poll]);

  const submitReview = useCallback(
    async (findingId: string, resolution: ReviewResolution) => {
      const target = sessionRef.current;
      if (!target) {
        return;
      }
      dispatch({ type: "reviewStart", findingId });
      try {
        const response = await reviewFinding(
          apiConfig(target),
          target.tournamentId,
          findingId,
          resolution,
        );
        const review: FeedReview = {
          resolution: response.review.resolution,
          reviewedBy: response.review.reviewedBy,
          ...(response.review.note ? { note: response.review.note } : {}),
        };
        dispatch({ type: "reviewSuccess", findingId, review });
      } catch (error) {
        dispatch({
          type: "reviewError",
          findingId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [apiConfig],
  );

  const items = orderedFeedItems(state);

  if (!session) {
    return (
      <Panel title="Referee login" subtitle="Paste a backend bearer token and pick a tournament.">
        <TextField
          label="Backend endpoint"
          value={draft.endpoint}
          onChange={(v) => setDraft({ ...draft, endpoint: v })}
        />
        <TextField
          label="Bearer token"
          value={draft.token}
          onChange={(v) => setDraft({ ...draft, token: v })}
          placeholder="token from /auth/register"
        />
        <TextField
          label="Tournament id"
          value={draft.tournamentId}
          onChange={(v) => setDraft({ ...draft, tournamentId: v })}
          placeholder="e.g. tournament-abc"
        />
        <PillButton
          label="Connect"
          variant="accent"
          onClick={connect}
          disabled={!draft.token.trim() || !draft.tournamentId.trim()}
        />
        <p style={{ color: theme.textDim, fontSize: 12, margin: 0 }}>
          The referee feed shows every finding for the tournament. Players in
          referee-only mode see nothing on their own devices.
        </p>
      </Panel>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title={`Referee feed — ${session.tournamentId}`}
        subtitle={
          mode
            ? `Visibility mode: ${mode}${polling ? " · refreshing…" : ""}`
            : "Connecting…"
        }
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PillButton label="Refresh now" onClick={() => void poll()} />
          <PillButton label="Disconnect" variant="danger" onClick={disconnect} />
        </div>
        {state.lastError ? (
          <p style={{ color: theme.danger, fontSize: 12, margin: 0 }}>
            Last poll error: {state.lastError}
          </p>
        ) : state.lastUpdatedAt ? (
          <p style={{ color: theme.textDim, fontSize: 12, margin: 0 }}>
            Updated {new Date(state.lastUpdatedAt).toLocaleTimeString()} ·{" "}
            {items.length} finding(s)
          </p>
        ) : null}
      </Panel>

      <Panel title={`Findings (${items.length})`} subtitle="Ordered by severity, then confidence.">
        {items.length === 0 ? (
          <p style={{ color: theme.textDim, fontSize: 13, margin: 0 }}>
            No findings for this tournament yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {items.map((item) => {
              const { finding } = item;
              const reviewing = Boolean(state.reviewing[finding.findingId]);
              return (
                <li
                  key={finding.findingId}
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: `1px solid ${theme.panelBorder}`,
                    background: "#0e1521",
                    opacity: item.review ? 0.7 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: SEVERITY_COLORS[finding.severity], fontWeight: 700, fontSize: 13 }}>
                      {finding.severity}
                    </span>
                    <span style={{ color: theme.textDim, fontSize: 12 }}>
                      T{finding.turnNumber} · {finding.phase} · {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                  <span style={{ fontSize: 14 }}>{finding.description}</span>
                  <span style={{ color: theme.textDim, fontSize: 12 }}>
                    {finding.code}
                    {finding.ruleRefs.length > 0 ? ` · ${finding.ruleRefs.join(", ")}` : ""}
                    {` · audience: ${finding.audience}`}
                  </span>
                  {item.review ? (
                    <span style={{ color: theme.textDim, fontSize: 12 }}>
                      Reviewed: {item.review.resolution}
                      {item.review.reviewedBy ? ` by ${item.review.reviewedBy}` : ""}
                    </span>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <PillButton
                        label={item.acknowledged ? "Acknowledged" : "Acknowledge"}
                        disabled={item.acknowledged}
                        onClick={() => dispatch({ type: "acknowledge", findingId: finding.findingId })}
                      />
                      <PillButton
                        label="Confirm"
                        variant="accent"
                        disabled={reviewing}
                        onClick={() => void submitReview(finding.findingId, "confirmed")}
                      />
                      <PillButton
                        label="Dismiss"
                        variant="danger"
                        disabled={reviewing}
                        onClick={() => void submitReview(finding.findingId, "dismissed")}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
