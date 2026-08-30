"""Fingerprint index: build from card images, match by nearest neighbour.

The index is a flat list of ``CardEntry`` (card id, name, fingerprint). Query is
a brute-force Hamming scan — fine for a prototype at MTG's ~30k unique-art scale
(a linear scan of 30k 128-bit ints is well under a second per card); a BK-tree
or VP-tree can replace it later without changing the interface.

The card images come from the user's own Scryfall import (``core-carddb`` already
downloads Scryfall data). Nothing here fetches anything at runtime.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional

from .fingerprint import (
    FINGERPRINT_BITS,
    ImageLike,
    confidence_from_distance,
    fingerprint,
    hamming,
)

_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass(frozen=True)
class CardEntry:
    card_id: str
    name: str
    fingerprint: int


@dataclass(frozen=True)
class Match:
    card_id: str
    name: str
    distance: int
    confidence: float


class FingerprintIndex:
    """An in-memory, serialisable perceptual-hash index over card art."""

    def __init__(self, entries: Optional[Iterable[CardEntry]] = None, *, bits: int = FINGERPRINT_BITS):
        self.entries: list[CardEntry] = list(entries) if entries else []
        self.bits = bits

    def __len__(self) -> int:
        return len(self.entries)

    def add(self, card_id: str, name: str, fp: int) -> None:
        self.entries.append(CardEntry(card_id, name, fp))

    def add_image(self, card_id: str, name: str, image: ImageLike) -> None:
        self.add(card_id, name, fingerprint(image))

    def query(self, fp: int, top_k: int = 3) -> list[Match]:
        scored = sorted(
            ((hamming(fp, entry.fingerprint), entry) for entry in self.entries),
            key=lambda pair: pair[0],
        )
        return [
            Match(entry.card_id, entry.name, dist, confidence_from_distance(dist, self.bits))
            for dist, entry in scored[:top_k]
        ]

    def best(self, fp: int) -> Optional[Match]:
        matches = self.query(fp, top_k=1)
        return matches[0] if matches else None

    # -- persistence ---------------------------------------------------------

    def save(self, path: ImageLike) -> None:
        payload = {
            "version": 1,
            "bits": self.bits,
            "entries": [
                {"id": e.card_id, "name": e.name, "fp": format(e.fingerprint, "x")}
                for e in self.entries
            ],
        }
        Path(path).write_text(json.dumps(payload), encoding="utf-8")

    @classmethod
    def load(cls, path: ImageLike) -> "FingerprintIndex":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        entries = [
            CardEntry(item["id"], item.get("name", item["id"]), int(item["fp"], 16))
            for item in payload.get("entries", [])
        ]
        return cls(entries, bits=payload.get("bits", FINGERPRINT_BITS))

    # -- building ------------------------------------------------------------

    @classmethod
    def build_from_dir(
        cls,
        images_dir: ImageLike,
        *,
        name_lookup: Optional[Callable[[str], str]] = None,
    ) -> "FingerprintIndex":
        """Fingerprint every image in ``images_dir``.

        The card id is the filename stem (e.g. a Scryfall id or oracle id); pass
        ``name_lookup`` to resolve a display name (e.g. from ``core-carddb``).
        """
        index = cls()
        directory = Path(images_dir)
        for image_path in sorted(directory.iterdir()):
            if image_path.suffix.lower() not in _IMAGE_SUFFIXES:
                continue
            card_id = image_path.stem
            name = name_lookup(card_id) if name_lookup else card_id
            index.add_image(card_id, name, image_path)
        return index
