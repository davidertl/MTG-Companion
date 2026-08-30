"""Fingerprint + index tests using synthetic cards (Pillow only, offline).

Proves the core loop without any real card art or a camera: build distinct
synthetic "cards", simulate a noisy camera capture of each, and confirm the
index identifies the right card and rejects the others.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from PIL import Image  # noqa: E402

from paperc_vision.fingerprint import FINGERPRINT_BITS, fingerprint, hamming  # noqa: E402
from paperc_vision.index import FingerprintIndex  # noqa: E402

BASE_W, BASE_H = 90, 126


def _make_card(kind: str) -> Image.Image:
    """Deterministic, visually distinct card image with strong low-freq structure."""
    img = Image.new("RGB", (BASE_W, BASE_H))
    px = img.load()
    for y in range(BASE_H):
        for x in range(BASE_W):
            fx, fy = x / (BASE_W - 1), y / (BASE_H - 1)
            if kind == "horizontal":
                v = int(255 * fx)
            elif kind == "vertical":
                v = int(255 * fy)
            elif kind == "diagonal":
                v = int(255 * (fx + fy) / 2)
            else:  # blocks
                v = 235 if ((x // (BASE_W // 3) + y // (BASE_H // 3)) % 2 == 0) else 30
            px[x, y] = (v, v, v)
    return img


def _simulate_capture(img: Image.Image, brightness: int = 12) -> Image.Image:
    """Approximate a phone capture: resample down/up and shift brightness."""
    small = img.resize((BASE_W // 2, BASE_H // 2), Image.Resampling.BILINEAR)
    back = small.resize((BASE_W, BASE_H), Image.Resampling.BILINEAR)
    return back.point(lambda p: min(255, p + brightness))


CARDS = {
    "card-horizontal": "horizontal",
    "card-vertical": "vertical",
    "card-diagonal": "diagonal",
    "card-blocks": "blocks",
}


class FingerprintMatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.index = FingerprintIndex()
        for card_id, kind in CARDS.items():
            self.index.add_image(card_id, card_id.replace("card-", "").title(), _make_card(kind))

    def test_each_card_identifies_itself_under_capture_noise(self) -> None:
        for card_id, kind in CARDS.items():
            query = _simulate_capture(_make_card(kind))
            best = self.index.best(fingerprint(query))
            self.assertIsNotNone(best)
            self.assertEqual(best.card_id, card_id, f"{card_id} misidentified as {best.card_id}")
            self.assertGreater(best.confidence, 0.85, f"{card_id} confidence too low: {best.confidence}")

    def test_self_distance_beats_cross_distance(self) -> None:
        horiz = fingerprint(_simulate_capture(_make_card("horizontal")))
        self_entry = next(e for e in self.index.entries if e.card_id == "card-horizontal")
        vert_entry = next(e for e in self.index.entries if e.card_id == "card-vertical")
        self_dist = hamming(horiz, self_entry.fingerprint)
        cross_dist = hamming(horiz, vert_entry.fingerprint)
        self.assertLess(self_dist, cross_dist)
        self.assertLess(self_dist, 0.15 * FINGERPRINT_BITS)

    def test_top_k_ordering_is_ascending_distance(self) -> None:
        matches = self.index.query(fingerprint(_make_card("diagonal")), top_k=4)
        self.assertEqual(matches[0].card_id, "card-diagonal")
        distances = [m.distance for m in matches]
        self.assertEqual(distances, sorted(distances))

    def test_index_save_load_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.json"
            self.index.save(path)
            reloaded = FingerprintIndex.load(path)
            self.assertEqual(len(reloaded), len(self.index))
            query = fingerprint(_simulate_capture(_make_card("blocks")))
            self.assertEqual(reloaded.best(query).card_id, "card-blocks")

    def test_build_from_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for card_id, kind in CARDS.items():
                _make_card(kind).save(Path(tmp) / f"{card_id}.png")
            index = FingerprintIndex.build_from_dir(tmp)
            self.assertEqual(len(index), len(CARDS))
            query = fingerprint(_simulate_capture(_make_card("vertical")))
            self.assertEqual(index.best(query).card_id, "card-vertical")


if __name__ == "__main__":
    unittest.main()
