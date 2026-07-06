/**
 * Build the PaperC card-name autocomplete index from a Scryfall bulk file.
 *
 * This runs at BUILD time only — never at app runtime — so the PaperC PWA stays
 * fully offline-capable. Download a bulk file manually (consent-gated, no
 * runtime fetching) from Scryfall's bulk-data API, e.g. the "Oracle Cards"
 * export: https://scryfall.com/docs/api/bulk-data
 *
 * Usage:
 *   node --experimental-strip-types scripts/build_card_name_index.ts \
 *     <path-to-scryfall-oracle-cards.json> \
 *     [apps/paperc/src/data/card-name-index.json]
 *
 * The committed index (apps/paperc/src/data/card-name-index.json) is a small
 * placeholder sample; regenerate it with the command above to get the full set.
 *
 * NOTE: written to be safe under `node --experimental-strip-types` — no enums,
 * no namespaces, no decorators, no parameter properties.
 */

import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = resolve(
  fileURLToPath(new URL("../apps/paperc/src/data/card-name-index.json", import.meta.url)),
);

const NAME_RE = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

async function extractNames(inputPath: string): Promise<Set<string>> {
  const names = new Set<string>();
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(inputPath, {
      encoding: "utf8",
      highWaterMark: 1 << 20,
    });
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      let lastIndex = 0;
      NAME_RE.lastIndex = 0;
      let match = NAME_RE.exec(buffer);
      while (match !== null) {
        names.add(decodeJsonString(match[1]));
        lastIndex = NAME_RE.lastIndex;
        match = NAME_RE.exec(buffer);
      }
      // Keep the unmatched tail so a name split across a chunk boundary is
      // matched on the next pass; bounds memory to roughly one card object.
      buffer = buffer.slice(lastIndex);
    });
    stream.on("end", () => resolvePromise());
    stream.on("error", reject);
  });
  return names;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;
  if (!inputPath) {
    console.error(
      "usage: node --experimental-strip-types scripts/build_card_name_index.ts <scryfall-bulk.json> [out.json]",
    );
    process.exit(1);
    return;
  }

  const names = await extractNames(resolve(inputPath));
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: basename(inputPath),
    count: sorted.length,
    names: sorted,
  };
  await writeFile(resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${sorted.length} card names to ${outputPath}`);
}

await main();
