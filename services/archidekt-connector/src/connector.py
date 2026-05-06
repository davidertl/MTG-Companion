from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable


class ArchidektImportError(RuntimeError):
    """Raised when a deck cannot be imported or normalized safely."""


try:
    from pyrchidekt.api import getDeckById as _default_get_deck_by_id
except Exception:  # pragma: no cover - exercised via injected fetchers in tests
    _default_get_deck_by_id = None


@dataclass(frozen=True)
class NormalizedDeckCard:
    name: str
    quantity: int
    category: str


def import_deck(deck_id: str | int, fetcher: Callable[[Any], Any] | None = None) -> dict[str, Any]:
    fetch = fetcher or _default_get_deck_by_id
    if fetch is None:
        raise ArchidektImportError("pyrchidekt is not available; provide an explicit fetcher")

    try:
        deck = fetch(deck_id)
    except Exception as exc:  # pragma: no cover - covered via explicit error tests
        raise ArchidektImportError(f"failed to fetch deck {deck_id}: {exc}") from exc

    return normalize_deck(deck, str(deck_id))


IntegrationError = ArchidektImportError


def normalize_deck(deck: Any, deck_id: str) -> dict[str, Any]:
    name = getattr(deck, "name", None)
    if not name:
        raise ArchidektImportError("deck name is required")

    categories = getattr(deck, "categories", None)
    flat_cards = getattr(deck, "cards", None)

    card_rows: list[tuple[str, list[Any]]] = []
    if categories:
        for category in categories:
            category_name = getattr(category, "name", None) or "mainboard"
            card_rows.append((category_name, list(getattr(category, "cards", []))))
    elif flat_cards is not None:
        card_rows.append(("mainboard", list(flat_cards)))

    normalized_cards: "OrderedDict[tuple[str, str], dict[str, Any]]" = OrderedDict()
    for category_name, cards in card_rows:
        for card in cards:
            quantity = int(getattr(card, "quantity", 0))
            card_name = getattr(getattr(card, "card", None), "oracle_card", None)
            card_name = getattr(card_name, "name", None)
            if quantity <= 0 or not card_name:
                raise ArchidektImportError("cards must expose a positive quantity and oracle name")

            normalized_cards.setdefault(
                (card_name, category_name),
                {
                    "name": card_name,
                    "quantity": quantity,
                    "category": category_name,
                },
            )

    updated_at = getattr(deck, "updated_at", "unknown")
    if isinstance(updated_at, datetime):
        updated_at = updated_at.isoformat()
    elif updated_at is None:
        updated_at = "unknown"
    else:
        updated_at = str(updated_at)

    return {
        "source": "archidekt",
        "deckId": deck_id,
        "name": name,
        "updatedAt": updated_at,
        "cards": list(normalized_cards.values()),
    }
