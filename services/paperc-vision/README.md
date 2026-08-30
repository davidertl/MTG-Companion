# MancuTG-PaperC vision (prototype)

Offline **card identification** for paper play: turn a photo of one or more
physical cards into candidate card identities with a confidence score, packaged
as `paperc.observation.detected` events for the existing PaperC pipeline.

> **Status: experimental prototype.** It is not wired into the main test gate
> (`verify:all`) yet, because it needs Python image libraries the CI image
> doesn't install. Run its tests standalone (below).

## Approach (and provenance)

This is a **clean-room** implementation of the classical computer-vision method
used by well-known MTG collection scanners:

1. **Detect** card-shaped quadrilaterals in a frame and perspective-correct each
   to an upright crop (OpenCV). Several quads per frame = multi-card detection.
2. **Fingerprint** each crop with a perceptual hash (combined aHash + dHash,
   128 bits).
3. **Match** the fingerprint against a precomputed per-card index by nearest
   Hamming distance, above a confidence threshold.
4. **Look up** the winning id (here, the id you named the image by — e.g. a
   Scryfall id).

We arrived at this design by observing *that* such scanners use OpenCV plus a
precomputed fingerprint database (a factual, structural observation) — **no
third-party app's code, model, or data is used or reproduced.** The fingerprint
index is built from **your own** Scryfall card art (`core-carddb` already imports
Scryfall). Nothing here fetches anything at runtime; it is fully offline.

## What it does NOT do

It identifies *which card* is on the table. It does **not** track *which zone a
card is in* or *what move happened this turn* — that temporal board-state layer
is a separate design and is not attempted here.

## Layout

- `src/paperc_vision/fingerprint.py` — perceptual hashes (Pillow only)
- `src/paperc_vision/index.py` — build / save / load / query the fingerprint index
- `src/paperc_vision/detect.py` — OpenCV card-quad detection (optional extra)
- `src/paperc_vision/observation.py` — build `paperc.observation.detected` events
- `src/paperc_vision/pipeline.py` — image(s) → matches → observations
- `src/paperc_vision/__main__.py` — CLI

## Install

```bash
cd services/paperc-vision
python -m pip install -e .            # core (Pillow) — identify pre-cropped cards
python -m pip install -e '.[camera]'  # + OpenCV — detect cards in a full photo
```

## Use

```bash
# 1. Build a fingerprint index from a folder of card art (filename stem = card id)
python -m paperc_vision build-index --images ./card-art --out index.json

# 2a. Identify an already-cropped card (Pillow only)
python -m paperc_vision identify --index index.json --card ./crop.jpg

# 2b. Detect + identify every card in a full photo (needs the [camera] extra)
python -m paperc_vision identify --index index.json --frame ./table.jpg

# 3. Emit observation events for a photo (feeds POST /events)
python -m paperc_vision observe --index index.json --frame ./table.jpg \
    --capture capture.json --now 2026-07-11T10:00:00Z
```

`capture.json` supplies the capture context, e.g.:

```json
{ "captureSessionId": "cap-1", "cameraId": "table-cam-a", "gameKey": "mtg-paper",
  "tournamentId": "cup-2026", "tableId": "table-3" }
```

Low-confidence detections are emitted with `reviewStatus: "pending"` so the
backend's referee/review flow confirms them — the machine never rules on its own.

## Test

Offline, needs only Pillow:

```bash
python -m pip install pillow
python -m unittest discover -s services/paperc-vision/tests -p "test_*.py"
```
