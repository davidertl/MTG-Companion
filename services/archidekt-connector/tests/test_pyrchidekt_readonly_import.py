import pathlib
import sys
import unittest
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

import connector
from connector import ArchidektImportError, import_deck


class FakeCard:
    def __init__(self, name: str, quantity: int) -> None:
        self.quantity = quantity
        self.card = type("CardRef", (), {"oracle_card": type("Oracle", (), {"name": name})()})()


class FakeCategory:
    def __init__(self, name: str, cards: list[FakeCard]) -> None:
        self.name = name
        self.cards = cards


class FakeDeck:
    def __init__(self) -> None:
        self.name = "OTJ Midrange"
        self.updated_at = datetime(2026, 5, 6, 21, 15, 0)
        self.categories = [
            FakeCategory("Mainboard", [FakeCard("Tinybones, the Pickpocket", 2)]),
            FakeCategory("Sideboard", [FakeCard("Duress", 3)]),
        ]


class ConnectorTests(unittest.TestCase):
    def test_imports_a_read_only_archidekt_snapshot(self) -> None:
        snapshot = import_deck("42", fetcher=lambda _: FakeDeck())

        self.assertEqual(snapshot["source"], "archidekt")
        self.assertEqual(snapshot["deckId"], "42")
        self.assertEqual(snapshot["name"], "OTJ Midrange")
        self.assertEqual(snapshot["updatedAt"], "2026-05-06T21:15:00")
        self.assertEqual(len(snapshot["cards"]), 2)
        self.assertEqual(snapshot["cards"][0]["quantity"], 2)

    def test_raises_integration_error_for_missing_fetcher(self) -> None:
        original_fetcher = connector._default_get_deck_by_id
        connector._default_get_deck_by_id = None
        try:
            with self.assertRaises(ArchidektImportError):
                import_deck("42", fetcher=None)
        finally:
            connector._default_get_deck_by_id = original_fetcher

    def test_normalizes_fetcher_failures(self) -> None:
        with self.assertRaises(ArchidektImportError):
            import_deck("42", fetcher=lambda _: (_ for _ in ()).throw(RuntimeError("boom")))

    def test_deduplicates_repeated_category_cards(self) -> None:
        repeated = FakeCard("Tinybones, the Pickpocket", 2)
        deck = FakeDeck()
        deck.categories = [
            FakeCategory("Mainboard", [repeated]),
            FakeCategory("Mainboard", [repeated]),
        ]

        snapshot = connector.normalize_deck(deck, "42")

        self.assertEqual(snapshot["cards"], [{"name": "Tinybones, the Pickpocket", "quantity": 2, "category": "Mainboard"}])


if __name__ == "__main__":
    unittest.main()
