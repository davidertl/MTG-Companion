import type { DeckSnapshot } from "../../../../../packages/shared-schema/src/index";

export interface DecksRouteOptions {
  archidektEnabled?: boolean;
  lastImportError?: string | null;
}

export function buildDecksRouteState(
  decks: DeckSnapshot[],
  options: DecksRouteOptions = {},
) {
  const archidektEnabled = options.archidektEnabled ?? false;
  return {
    title: "Decks",
    totalDecks: decks.length,
    deckNames: decks.map((deck) => deck.name),
    empty: decks.length === 0,
    archidektEnabled,
    readOnlyImport: true,
    importActionLabel: archidektEnabled
      ? "Import Archidekt deck (read-only)"
      : "Enable Archidekt access to import decks",
    statusMessage: options.lastImportError
      ? `Archidekt import failed: ${options.lastImportError}`
      : archidektEnabled
        ? "Read-only Archidekt imports are available."
        : "Archidekt stays offline until explicitly enabled.",
  };
}
