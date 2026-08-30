"""Observation builder tests: output conforms to the PaperC event contract."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from paperc_vision.index import Match  # noqa: E402
from paperc_vision.observation import build_card_observation, needs_review  # noqa: E402

CAPTURE = {
    "captureSessionId": "cap-1",
    "cameraId": "table-cam-a",
    "gameKey": "mtg-paper",
    "tournamentId": "cup-2026",
    "tableId": "table-3",
}


class ObservationTest(unittest.TestCase):
    def _obs(self, confidence: float):
        match = Match(card_id="scry-abc", name="Lightning Bolt", distance=4, confidence=confidence)
        return build_card_observation(
            match,
            capture=CAPTURE,
            event_id="obs-0",
            occurred_at="2026-07-11T10:00:00Z",
            frame_ref="frame-000123.jpg",
        )

    def test_envelope_matches_contract(self) -> None:
        obs = self._obs(0.97)
        self.assertEqual(obs["eventType"], "paperc.observation.detected")
        self.assertEqual(obs["sourceApp"], "mancutg-paperc")
        self.assertEqual(obs["sourceSessionId"], "cap-1")
        self.assertEqual(obs["provenance"][0]["sourceKind"], "paper-camera")
        self.assertEqual(obs["provenance"][0]["cameraId"], "table-cam-a")
        self.assertTrue(0.0 <= obs["confidence"] <= 1.0)

    def test_payload_carries_candidate_and_scope(self) -> None:
        payload = self._obs(0.97)["payload"]
        self.assertEqual(payload["observationKind"], "card-move")
        self.assertEqual(payload["candidateRef"], "scry-abc")
        self.assertEqual(payload["confidenceHint"], 0.97)
        self.assertEqual(payload["gameKey"], "mtg-paper")
        self.assertEqual(payload["tournamentId"], "cup-2026")
        self.assertEqual(payload["tableId"], "table-3")
        self.assertEqual(payload["frameRef"], "frame-000123.jpg")
        self.assertEqual(payload["details"]["cardName"], "Lightning Bolt")

    def test_high_confidence_auto_accepts_low_goes_to_review(self) -> None:
        self.assertEqual(self._obs(0.97)["reviewStatus"], "auto-accepted")
        self.assertEqual(self._obs(0.40)["reviewStatus"], "pending")
        self.assertTrue(needs_review(Match("x", "X", 40, 0.40)))
        self.assertFalse(needs_review(Match("x", "X", 2, 0.98)))


if __name__ == "__main__":
    unittest.main()
