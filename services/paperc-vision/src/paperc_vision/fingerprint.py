"""Perceptual fingerprints for card images (Pillow-only, no heavy deps).

A card is reduced to a compact bit fingerprint so two images of the same card
match with a small Hamming distance, and different cards do not. We combine two
classic perceptual hashes for robustness:

- **aHash** (average hash): 8x8 grayscale, bit = pixel > mean. Captures overall
  tone / large blocks.
- **dHash** (difference hash): 9x8 grayscale, bit = left pixel > right pixel.
  Captures horizontal gradient structure and is robust to brightness shifts.

The two 64-bit hashes are concatenated into a 128-bit fingerprint. This is the
same family of technique classical card scanners use against a precomputed card
database; here it is implemented from scratch.
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from PIL import Image

try:  # Pillow >= 9.1
    _RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - very old Pillow
    _RESAMPLE = Image.LANCZOS

HASH_SIDE = 8
_HASH_BITS = HASH_SIDE * HASH_SIDE  # 64 per hash
FINGERPRINT_BITS = _HASH_BITS * 2  # 128 combined

ImageLike = Union[str, Path, Image.Image]


def _load(image: ImageLike) -> Image.Image:
    if isinstance(image, Image.Image):
        return image
    return Image.open(image)


def _gray(image: Image.Image, width: int, height: int) -> list[int]:
    """Row-major grayscale pixels of ``image`` resized to ``width`` x ``height``."""
    small = image.convert("L").resize((width, height), _RESAMPLE)
    # Pillow 12+ renamed getdata() -> get_flattened_data(); support both.
    if hasattr(small, "get_flattened_data"):
        return list(small.get_flattened_data())
    return list(small.getdata())


def _bits_to_int(bits: list[int]) -> int:
    value = 0
    for bit in bits:
        value = (value << 1) | (1 if bit else 0)
    return value


def average_hash(image: ImageLike, side: int = HASH_SIDE) -> int:
    px = _gray(_load(image), side, side)
    avg = sum(px) / len(px)
    return _bits_to_int([1 if p > avg else 0 for p in px])


def difference_hash(image: ImageLike, side: int = HASH_SIDE) -> int:
    width = side + 1
    px = _gray(_load(image), width, side)
    bits: list[int] = []
    for row in range(side):
        base = row * width
        for col in range(side):
            bits.append(1 if px[base + col] > px[base + col + 1] else 0)
    return _bits_to_int(bits)


def fingerprint(image: ImageLike) -> int:
    """Combined 128-bit fingerprint: dHash in the high 64 bits, aHash in the low 64."""
    img = _load(image)
    return (difference_hash(img) << _HASH_BITS) | average_hash(img)


def hamming(a: int, b: int) -> int:
    """Number of differing bits between two fingerprints."""
    return (a ^ b).bit_count()


def confidence_from_distance(distance: int, bits: int = FINGERPRINT_BITS) -> float:
    """Map a Hamming distance to a 0..1 similarity score."""
    if bits <= 0:
        return 0.0
    return max(0.0, min(1.0, 1.0 - distance / bits))
