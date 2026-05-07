import {
  archidektDeckSnapshotSchema,
  type ArchidektDeckSnapshot,
} from "../../../../../../packages/shared-schema/src/archidekt.ts";

export type ArchidektFetcher = (deckId: string) => Promise<unknown>;

export function buildArchidektImportRoute(fetchSnapshot: ArchidektFetcher) {
  return async function importDeck(deckId: string): Promise<ArchidektDeckSnapshot> {
    const rawSnapshot = await fetchSnapshot(deckId);
    const parsed = archidektDeckSnapshotSchema.parse(rawSnapshot);
    if (parsed.deckId !== deckId) {
      throw new Error(`connector returned deckId ${parsed.deckId} for requested deck ${deckId}`);
    }

    return parsed;
  };
}
