"""CLI for the PaperC vision prototype.

    python -m paperc_vision build-index --images ./card-art --out index.json
    python -m paperc_vision identify --index index.json --card cropped.jpg
    python -m paperc_vision observe  --index index.json --frame table.jpg \
        --capture capture.json --now 2026-07-11T10:00:00Z

`identify --card` treats the image as an already-cropped card (Pillow only).
`identify --frame` / `observe` detect card quads in a full photo (needs OpenCV).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .index import FingerprintIndex
from .pipeline import identify_card_image


def _cmd_build_index(args: argparse.Namespace) -> int:
    index = FingerprintIndex.build_from_dir(args.images)
    index.save(args.out)
    print(f"built index: {len(index)} cards -> {args.out}")
    return 0


def _cmd_identify(args: argparse.Namespace) -> int:
    index = FingerprintIndex.load(args.index)
    if args.card:
        matches = identify_card_image(args.card, index, top_k=args.top_k)
    else:
        from .detect import find_card_crops, read_frame
        from .fingerprint import fingerprint

        frame = read_frame(args.frame)
        crops = find_card_crops(frame, max_cards=args.max_cards)
        print(f"detected {len(crops)} card(s)")
        matches = [index.best(fingerprint(crop)) for crop in crops]
        matches = [m for m in matches if m is not None]

    for m in matches:
        print(f"  {m.confidence:.3f}  {m.card_id}  {m.name}  (dist={m.distance})")
    return 0


def _cmd_observe(args: argparse.Namespace) -> int:
    from .detect import read_frame
    from .pipeline import identify_frame

    index = FingerprintIndex.load(args.index)
    capture = json.loads(Path(args.capture).read_text(encoding="utf-8"))
    frame = read_frame(args.frame)
    observations = identify_frame(
        frame,
        index,
        capture,
        id_factory=lambda i: f"{args.event_prefix}-{i}",
        now=args.now,
        frame_ref=args.frame,
    )
    json.dump(observations, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="paperc_vision", description=__doc__)
    parser.add_argument("--version", action="version", version=f"paperc-vision {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build-index", help="fingerprint a folder of card art")
    p_build.add_argument("--images", required=True, help="directory of card images (stem = card id)")
    p_build.add_argument("--out", required=True, help="output index JSON path")
    p_build.set_defaults(func=_cmd_build_index)

    p_id = sub.add_parser("identify", help="identify a card image or a full frame")
    p_id.add_argument("--index", required=True)
    p_id.add_argument("--card", help="an already-cropped card image (Pillow only)")
    p_id.add_argument("--frame", help="a full photo; detects card quads (needs OpenCV)")
    p_id.add_argument("--top-k", type=int, default=3)
    p_id.add_argument("--max-cards", type=int, default=8)
    p_id.set_defaults(func=_cmd_identify)

    p_obs = sub.add_parser("observe", help="identify a frame and emit observation events")
    p_obs.add_argument("--index", required=True)
    p_obs.add_argument("--frame", required=True)
    p_obs.add_argument("--capture", required=True, help="capture-context JSON")
    p_obs.add_argument("--now", required=True, help="ISO occurredAt timestamp")
    p_obs.add_argument("--event-prefix", default="obs")
    p_obs.set_defaults(func=_cmd_observe)

    args = parser.parse_args(argv)
    if args.command == "identify" and not (args.card or args.frame):
        parser.error("identify needs either --card or --frame")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
