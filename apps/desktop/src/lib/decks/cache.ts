import {
  archidektDeckSnapshotSchema,
  type ArchidektDeckSnapshot,
} from "../../../../../packages/shared-schema/src/archidekt";

export type DeckCache = Map<string, ArchidektDeckSnapshot>;

function toCacheEntries(cache: DeckCache | ArchidektDeckSnapshot[]): [string, ArchidektDeckSnapshot][] {
  if (cache instanceof Map) {
    return [...cache.entries()];
  }

  return cache.map((snapshot) => [snapshot.deckId, snapshot]);
}

export function cacheArchidektSnapshot(
  cache: DeckCache | ArchidektDeckSnapshot[],
  snapshot: unknown,
): DeckCache {
  const parsed = archidektDeckSnapshotSchema.parse(snapshot);
  const next = new Map(toCacheEntries(cache));
  next.set(parsed.deckId, parsed);
  return next;
}

export function getCachedDeck(cache: DeckCache, deckId: string): ArchidektDeckSnapshot | undefined {
  return cache.get(deckId);
}
