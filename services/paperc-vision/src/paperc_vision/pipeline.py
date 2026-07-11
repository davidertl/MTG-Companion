"""High-level identify pipeline: image(s) -> matches -> observations.

Two entry points:

- ``identify_card_image`` — a single already-cropped card image to candidate
  matches. Needs only Pillow, so it is fully testable offline.
- ``identify_frame`` — a full camera photo: detect card quads (OpenCV) and emit
  one observation per identified card. This is the real "point the camera at the
  table" path.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional

from .fingerprint import ImageLike, fingerprint
from .index import FingerprintIndex, Match
from .observation import build_card_observation


def identify_card_image(image: ImageLike, index: FingerprintIndex, top_k: int = 3) -> list[Match]:
    return index.query(fingerprint(image), top_k=top_k)


def identify_frame(
    frame,
    index: FingerprintIndex,
    capture: Mapping[str, Any],
    *,
    id_factory: Callable[[int], str],
    now: str,
    frame_ref: Optional[str] = None,
    max_cards: int = 8,
) -> list[dict[str, Any]]:
    """Detect and identify every card in a BGR frame; return observation events.

    ``id_factory(i)`` supplies a stable event id per detection and ``now`` is the
    ISO timestamp — both injected so the pipeline stays deterministic/testable.
    """
    from .detect import find_card_crops  # local import keeps OpenCV optional

    observations: list[dict[str, Any]] = []
    for i, crop in enumerate(find_card_crops(frame, max_cards=max_cards)):
        best = index.best(fingerprint(crop))
        if best is None:
            continue
        observations.append(
            build_card_observation(
                best,
                capture=capture,
                event_id=id_factory(i),
                occurred_at=now,
                frame_ref=frame_ref,
            )
        )
    return observations
