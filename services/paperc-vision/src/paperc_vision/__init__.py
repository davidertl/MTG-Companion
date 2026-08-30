"""MancuTG-PaperC vision prototype.

Clean-room, offline card *identification* for paper play. Inspired by the
well-known classical-CV approach used by collection scanners (OpenCV quad
detection + a precomputed per-card fingerprint database matched by nearest
neighbour) — but implemented from scratch here, using only permissively
licensed libraries and fingerprints built from the user's own Scryfall card
images. No third-party app's code, model, or data is used.

Scope: this turns a photo of one or more physical cards into candidate card
identities with a confidence score, packaged as `paperc.observation.detected`
events for the existing PaperC pipeline. It does NOT do in-game move/zone
tracking over time — that temporal layer is a separate design.
"""

__version__ = "0.0.1"

from .fingerprint import fingerprint, hamming, FINGERPRINT_BITS
from .index import CardEntry, FingerprintIndex, Match
from .observation import build_card_observation, needs_review

__all__ = [
    "__version__",
    "fingerprint",
    "hamming",
    "FINGERPRINT_BITS",
    "CardEntry",
    "FingerprintIndex",
    "Match",
    "build_card_observation",
    "needs_review",
]
