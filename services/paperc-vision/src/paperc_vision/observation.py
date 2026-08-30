"""Turn a card match into a `paperc.observation.detected` event.

The output dict conforms to the shared PaperC event contract
(`packages/shared-schema/src/paperc.ts`): a camera-sourced observation with
`provenance.sourceKind = "paper-camera"`, an `observationKind`, a `candidateRef`
(the matched card id), a `confidenceHint`, and `reviewStatus`. Low-confidence
detections stay `reviewStatus = "pending"` so the backend's referee/review flow
confirms them rather than trusting the machine — the human-in-the-loop invariant.

Event ids and timestamps are injected by the caller (not generated here) so the
builder is pure and deterministic, mirroring the PaperC game-log reducer.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from . import __version__
from .index import Match

# Below this combined-hash confidence, a detection should be treated as a
# candidate for human review rather than an authoritative observation.
DEFAULT_REVIEW_THRESHOLD = 0.85

_TOURNAMENT_KEYS = ("tournamentId", "roundId", "tableId", "matchId")


def needs_review(match: Match, threshold: float = DEFAULT_REVIEW_THRESHOLD) -> bool:
    return match.confidence < threshold


def build_card_observation(
    match: Match,
    *,
    capture: Mapping[str, Any],
    event_id: str,
    occurred_at: str,
    frame_ref: Optional[str] = None,
    observation_kind: str = "card-move",
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
) -> dict[str, Any]:
    """Build one observation event for a single detected/identified card.

    ``capture`` carries the capture-session context; it must include
    ``captureSessionId``, ``cameraId`` and ``gameKey`` and may include the
    tournament scoping keys.
    """
    confidence = round(match.confidence, 4)

    payload: dict[str, Any] = {
        "gameKey": capture["gameKey"],
        "captureSessionId": capture["captureSessionId"],
        "cameraId": capture["cameraId"],
        "observationKind": observation_kind,
        "candidateRef": match.card_id,
        "confidenceHint": confidence,
        "details": {
            "cardId": match.card_id,
            "cardName": match.name,
            "hammingDistance": match.distance,
            "engine": f"paperc-vision/{__version__}",
        },
    }
    if frame_ref is not None:
        payload["frameRef"] = frame_ref
    for key in _TOURNAMENT_KEYS:
        if key in capture and capture[key] is not None:
            payload[key] = capture[key]

    return {
        "eventId": event_id,
        "sourceApp": "mancutg-paperc",
        "sourceSessionId": capture["captureSessionId"],
        "eventType": "paperc.observation.detected",
        "occurredAt": occurred_at,
        "provenance": [
            {
                "sourceKind": "paper-camera",
                "sourceSessionId": capture["captureSessionId"],
                "cameraId": capture["cameraId"],
                "modelVersion": f"paperc-vision/{__version__}",
            }
        ],
        "confidence": confidence,
        "reviewStatus": "pending" if needs_review(match, review_threshold) else "auto-accepted",
        "payload": payload,
    }
