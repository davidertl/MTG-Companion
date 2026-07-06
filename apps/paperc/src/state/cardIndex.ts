/**
 * Card-name autocomplete over a build-time bundled index (plan 2026-07-06-001
 * W2.2). The index ships in the client bundle so autocomplete works fully
 * offline — there are NO runtime network calls. Regenerate the index from a
 * Scryfall bulk file with scripts/build_card_name_index.ts.
 */

import indexData from "../data/card-name-index.json";

export type CardNameIndex = {
  generatedAt: string;
  source: string;
  count: number;
  names: string[];
};

const index = indexData as unknown as CardNameIndex;

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) {
      i += 1;
    }
  }
  return i === needle.length;
}

/**
 * Ranked, offline card-name suggestions:
 *   1. prefix matches, 2. substring matches, 3. fuzzy subsequence matches.
 */
export function searchCardNames(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const prefix: string[] = [];
  const substring: string[] = [];
  const fuzzy: string[] = [];
  for (const name of index.names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) {
      prefix.push(name);
    } else if (lower.includes(q)) {
      substring.push(name);
    } else if (isSubsequence(q, lower)) {
      fuzzy.push(name);
    }
  }
  return [...prefix, ...substring, ...fuzzy].slice(0, limit);
}

export function cardIndexInfo(): { count: number; source: string; generatedAt: string } {
  return {
    count: index.count,
    source: index.source,
    generatedAt: index.generatedAt,
  };
}
