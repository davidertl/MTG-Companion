import type { DeckSnapshot } from "../../../../../packages/shared-schema/src/index";

export function buildDecksRouteState(decks: DeckSnapshot[]) {
  return {
    totalDecks: decks.length,
    deckNames: decks.map((deck) => deck.name),
    empty: decks.length === 0,
  };
}
