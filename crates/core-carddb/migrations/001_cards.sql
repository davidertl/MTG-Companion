CREATE TABLE IF NOT EXISTS cards (
  scryfall_id TEXT PRIMARY KEY,
  scryfall_oracle_id TEXT,
  arena_id INTEGER,
  name TEXT NOT NULL,
  mana_cost TEXT,
  cmc REAL,
  type_line TEXT,
  oracle_text TEXT,
  colors TEXT,
  keywords TEXT,
  legalities_json TEXT,
  set_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_arena_id ON cards(arena_id);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_name_nocase ON cards(name COLLATE NOCASE);
