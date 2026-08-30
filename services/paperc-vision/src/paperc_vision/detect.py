"""Card detection in a camera frame (OpenCV — optional dependency).

Finds card-shaped quadrilaterals in a photo and perspective-corrects each to a
normalised, upright card crop that can be fingerprinted. Multiple quads per
frame is exactly the "multi-card detection" case: detect N cards on the table,
identify each independently.

OpenCV is an optional extra (`pip install 'mancutg-paperc-vision[camera]'`).
This module imports fine without it; the detection functions raise a clear error
only when actually called, so the fingerprint/index/observation core stays
usable (and testable) with just Pillow.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PIL import Image

if TYPE_CHECKING:  # pragma: no cover
    from pathlib import Path

# Normalised card crop size (roughly the 2.5 x 3.5 inch card aspect ratio).
CARD_W = 336
CARD_H = 468

# A quad is accepted as a card only within this fraction-of-frame area range and
# near the card aspect ratio — cheap guards against noise and non-card contours.
_MIN_AREA_FRAC = 0.02
_MAX_AREA_FRAC = 0.95
_ASPECT = CARD_H / CARD_W
_ASPECT_TOL = 0.35


def _require_cv2():
    try:
        import cv2  # noqa: WPS433 (runtime-optional import)
    except ImportError as exc:  # pragma: no cover - exercised only without extra
        raise RuntimeError(
            "card detection needs OpenCV. Install the optional extra:\n"
            "    pip install 'mancutg-paperc-vision[camera]'"
        ) from exc
    return cv2


def _order_corners(pts):
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    import numpy as np

    pts = pts.reshape(4, 2).astype("float32")
    ordered = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1)
    ordered[0] = pts[np.argmin(s)]  # top-left  (smallest x+y)
    ordered[2] = pts[np.argmax(s)]  # bottom-right (largest x+y)
    ordered[1] = pts[np.argmin(d)]  # top-right (smallest y-x)
    ordered[3] = pts[np.argmax(d)]  # bottom-left (largest y-x)
    return ordered


def find_card_crops(frame_bgr, max_cards: int = 8) -> list[Image.Image]:
    """Detect card quads in a BGR frame and return upright PIL crops.

    ``frame_bgr`` is a numpy array as returned by ``cv2.imread`` / a webcam.
    """
    cv2 = _require_cv2()
    import numpy as np

    height, width = frame_bgr.shape[:2]
    frame_area = float(height * width)

    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    crops: list[Image.Image] = []
    dst = np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], dtype="float32")

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < _MIN_AREA_FRAC * frame_area or area > _MAX_AREA_FRAC * frame_area:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        if len(approx) != 4:
            continue

        corners = _order_corners(approx)
        (tl, tr, br, bl) = corners
        w = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
        h = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
        if w == 0:
            continue
        aspect = h / w
        if abs(aspect - _ASPECT) > _ASPECT_TOL:
            continue

        matrix = cv2.getPerspectiveTransform(corners, dst)
        warped = cv2.warpPerspective(frame_bgr, matrix, (CARD_W, CARD_H))
        rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
        crops.append(Image.fromarray(rgb))
        if len(crops) >= max_cards:
            break

    return crops


def read_frame(path) -> "object":
    """Load an image file to a BGR numpy frame (requires OpenCV)."""
    cv2 = _require_cv2()
    frame = cv2.imread(str(path))
    if frame is None:
        raise FileNotFoundError(f"could not read image: {path}")
    return frame
