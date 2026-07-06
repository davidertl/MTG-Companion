//! Offline card knowledge for MancuTG-Companion (`core-carddb`).
//!
//! Imports Scryfall bulk data ("Oracle Cards" file) into a local SQLite
//! database and answers lookups by Arena id and by card name. The bulk file
//! is downloaded **manually** by the user from
//! <https://scryfall.com/docs/api/bulk-data> — this crate performs no network
//! calls whatsoever (offline-first invariant).
//!
//! The real bulk file is on the order of 2 GB, so [`CardDb::import_scryfall_bulk`]
//! streams the top-level JSON array element by element and never materializes
//! the whole file in memory. Import is idempotent (`INSERT OR REPLACE` keyed
//! on `scryfall_id`) and batched into transactions of a few thousand rows.
//! Missing or extra fields on individual card objects are tolerated: entries
//! without an `id` or `name` are counted as skipped, unknown fields are
//! ignored, and absent optional fields become SQL NULLs.

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Rows per transaction while importing bulk data.
const IMPORT_BATCH_SIZE: usize = 2000;

/// Buffer size for the streaming bulk reader.
const IMPORT_READ_BUFFER_BYTES: usize = 1 << 20;

const INSERT_CARD_SQL: &str = "INSERT OR REPLACE INTO cards (
    scryfall_id,
    scryfall_oracle_id,
    arena_id,
    name,
    mana_cost,
    cmc,
    type_line,
    oracle_text,
    colors,
    keywords,
    legalities_json,
    set_code
 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)";

const SELECT_CARD_COLUMNS: &str = "scryfall_id, scryfall_oracle_id, arena_id, name, mana_cost, \
     cmc, type_line, oracle_text, colors, keywords, legalities_json, set_code";

/// Errors surfaced by the card database.
#[derive(Debug)]
pub enum CardDbError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
    Format(String),
}

impl fmt::Display for CardDbError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "card database error: {error}"),
            Self::Json(error) => {
                write!(formatter, "failed to parse Scryfall bulk JSON: {error}")
            }
            Self::Io(error) => write!(formatter, "failed to read Scryfall bulk data: {error}"),
            Self::Format(message) => {
                write!(formatter, "unexpected Scryfall bulk format: {message}")
            }
        }
    }
}

impl std::error::Error for CardDbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Sqlite(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Format(_) => None,
        }
    }
}

impl From<rusqlite::Error> for CardDbError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for CardDbError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<std::io::Error> for CardDbError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// One card row as stored in the local database.
///
/// `colors` and `keywords` are persisted as JSON string arrays in TEXT
/// columns and decoded back to `Vec<String>` on read. `legalities_json`
/// carries the raw Scryfall legalities object verbatim.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRecord {
    pub scryfall_id: String,
    pub scryfall_oracle_id: Option<String>,
    pub arena_id: Option<u64>,
    pub name: String,
    pub mana_cost: Option<String>,
    pub cmc: Option<f64>,
    pub type_line: Option<String>,
    pub oracle_text: Option<String>,
    pub colors: Vec<String>,
    pub keywords: Vec<String>,
    pub legalities_json: Option<String>,
    pub set_code: Option<String>,
}

/// Outcome of one bulk import run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    /// Card objects written (INSERT OR REPLACE) into the `cards` table.
    pub imported_cards: usize,
    /// Array elements skipped because they were not card objects with both
    /// an `id` and a `name`.
    pub skipped_entries: usize,
}

/// Aggregate counters describing the current card database contents.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDbStatus {
    pub card_count: usize,
    pub with_arena_id_count: usize,
}

pub struct CardDb {
    connection: Connection,
}

impl CardDb {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CardDbError> {
        let connection = Connection::open(path)?;
        let card_db = Self { connection };
        card_db.migrate()?;
        Ok(card_db)
    }

    pub fn open_in_memory() -> Result<Self, CardDbError> {
        let connection = Connection::open_in_memory()?;
        let card_db = Self { connection };
        card_db.migrate()?;
        Ok(card_db)
    }

    /// Streams a Scryfall bulk "oracle cards" JSON array from `reader` into
    /// the `cards` table without loading the file into memory.
    ///
    /// Idempotent: re-importing the same file leaves the same rows behind
    /// (`INSERT OR REPLACE` keyed on `scryfall_id`). Elements missing `id`
    /// or `name` are tolerated and counted in [`ImportStats::skipped_entries`].
    pub fn import_scryfall_bulk<R: Read>(&self, reader: R) -> Result<ImportStats, CardDbError> {
        let mut reader = BufReader::with_capacity(IMPORT_READ_BUFFER_BYTES, reader);
        skip_utf8_bom(&mut reader)?;
        skip_json_whitespace(&mut reader)?;
        match peek_byte(&mut reader)? {
            None => Ok(ImportStats::default()),
            Some(b'[') => {
                next_byte(&mut reader)?;
                self.import_array_elements(&mut reader)
            }
            Some(other) => Err(CardDbError::Format(format!(
                "expected a Scryfall bulk JSON array, found byte {other:#04x} at start of input"
            ))),
        }
    }

    pub fn lookup_by_arena_id(&self, arena_id: u64) -> Result<Option<CardRecord>, CardDbError> {
        self.query_single_card(
            &format!("SELECT {SELECT_CARD_COLUMNS} FROM cards WHERE arena_id = ?1 LIMIT 1"),
            params![arena_id as i64],
        )
    }

    /// Looks up a card by name — exact match first, then case-insensitive.
    pub fn lookup_by_name(&self, name: &str) -> Result<Option<CardRecord>, CardDbError> {
        if let Some(record) = self.query_single_card(
            &format!("SELECT {SELECT_CARD_COLUMNS} FROM cards WHERE name = ?1 LIMIT 1"),
            params![name],
        )? {
            return Ok(Some(record));
        }
        self.query_single_card(
            &format!(
                "SELECT {SELECT_CARD_COLUMNS} FROM cards WHERE name = ?1 COLLATE NOCASE LIMIT 1"
            ),
            params![name],
        )
    }

    pub fn status(&self) -> Result<CardDbStatus, CardDbError> {
        let card_count = self
            .connection
            .query_row("SELECT COUNT(*) FROM cards", [], |row| row.get::<_, i64>(0))?
            as usize;
        let with_arena_id_count = self.connection.query_row(
            "SELECT COUNT(*) FROM cards WHERE arena_id IS NOT NULL",
            [],
            |row| row.get::<_, i64>(0),
        )? as usize;
        Ok(CardDbStatus {
            card_count,
            with_arena_id_count,
        })
    }

    fn migrate(&self) -> Result<(), CardDbError> {
        self.connection
            .execute_batch(include_str!("../migrations/001_cards.sql"))?;
        Ok(())
    }

    fn import_array_elements<R: BufRead>(
        &self,
        reader: &mut R,
    ) -> Result<ImportStats, CardDbError> {
        let mut stats = ImportStats::default();
        let mut transaction = self.connection.unchecked_transaction()?;
        let mut rows_in_batch = 0_usize;

        skip_json_whitespace(reader)?;
        if peek_byte(reader)? == Some(b']') {
            next_byte(reader)?;
            transaction.commit()?;
            return Ok(stats);
        }

        loop {
            skip_json_whitespace(reader)?;
            // Card entries are always JSON objects. Objects are delimiter-
            // terminated, so deserializing one from the shared reader never
            // consumes bytes past its closing brace — this is what keeps the
            // element-by-element streaming loop sound.
            if peek_byte(reader)? != Some(b'{') {
                return Err(CardDbError::Format(
                    "expected a JSON object as bulk array element".to_owned(),
                ));
            }
            let element = {
                let mut deserializer = serde_json::Deserializer::from_reader(&mut *reader);
                Value::deserialize(&mut deserializer)?
            };

            if self.insert_bulk_element(&element)? {
                stats.imported_cards += 1;
                rows_in_batch += 1;
                if rows_in_batch >= IMPORT_BATCH_SIZE {
                    transaction.commit()?;
                    transaction = self.connection.unchecked_transaction()?;
                    rows_in_batch = 0;
                }
            } else {
                stats.skipped_entries += 1;
            }

            skip_json_whitespace(reader)?;
            match next_byte(reader)? {
                Some(b',') => continue,
                Some(b']') => break,
                Some(other) => {
                    return Err(CardDbError::Format(format!(
                        "expected ',' or ']' between bulk array elements, found byte {other:#04x}"
                    )))
                }
                None => {
                    return Err(CardDbError::Format(
                        "unexpected end of bulk file inside JSON array".to_owned(),
                    ))
                }
            }
        }

        transaction.commit()?;
        Ok(stats)
    }

    /// Writes one bulk array element. Returns `false` (skip) when the element
    /// is not an object carrying both `id` and `name`; all other fields are
    /// optional and default to NULL.
    fn insert_bulk_element(&self, element: &Value) -> Result<bool, CardDbError> {
        let Some(object) = element.as_object() else {
            return Ok(false);
        };
        let Some(scryfall_id) = object.get("id").and_then(Value::as_str) else {
            return Ok(false);
        };
        let Some(name) = object.get("name").and_then(Value::as_str) else {
            return Ok(false);
        };

        let mut statement = self.connection.prepare_cached(INSERT_CARD_SQL)?;
        statement.execute(params![
            scryfall_id,
            object.get("oracle_id").and_then(Value::as_str),
            object
                .get("arena_id")
                .and_then(Value::as_u64)
                .map(|value| value as i64),
            name,
            object.get("mana_cost").and_then(Value::as_str),
            object.get("cmc").and_then(Value::as_f64),
            object.get("type_line").and_then(Value::as_str),
            object.get("oracle_text").and_then(Value::as_str),
            string_array_json(object.get("colors")),
            string_array_json(object.get("keywords")),
            object.get("legalities").map(Value::to_string),
            object.get("set").and_then(Value::as_str),
        ])?;
        Ok(true)
    }

    fn query_single_card<P: rusqlite::Params>(
        &self,
        sql: &str,
        query_params: P,
    ) -> Result<Option<CardRecord>, CardDbError> {
        let mut statement = self.connection.prepare_cached(sql)?;
        let record = statement
            .query_row(query_params, row_to_card_record)
            .optional()?;
        Ok(record)
    }
}

fn row_to_card_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardRecord> {
    Ok(CardRecord {
        scryfall_id: row.get(0)?,
        scryfall_oracle_id: row.get(1)?,
        arena_id: row.get::<_, Option<i64>>(2)?.map(|value| value as u64),
        name: row.get(3)?,
        mana_cost: row.get(4)?,
        cmc: row.get(5)?,
        type_line: row.get(6)?,
        oracle_text: row.get(7)?,
        colors: parse_string_array(row.get::<_, Option<String>>(8)?),
        keywords: parse_string_array(row.get::<_, Option<String>>(9)?),
        legalities_json: row.get(10)?,
        set_code: row.get(11)?,
    })
}

/// Serializes a JSON array of strings to TEXT; non-string entries are
/// dropped, non-array values become NULL.
fn string_array_json(value: Option<&Value>) -> Option<String> {
    let entries = value?.as_array()?;
    let strings = entries
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    serde_json::to_string(&strings).ok()
}

fn parse_string_array(raw: Option<String>) -> Vec<String> {
    raw.and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn skip_utf8_bom<R: BufRead>(reader: &mut R) -> std::io::Result<()> {
    let buffer = reader.fill_buf()?;
    if buffer.starts_with(&[0xEF, 0xBB, 0xBF]) {
        reader.consume(3);
    }
    Ok(())
}

fn skip_json_whitespace<R: BufRead>(reader: &mut R) -> std::io::Result<()> {
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(());
        }
        let buffered = buffer.len();
        let consumed = buffer
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
            .count();
        reader.consume(consumed);
        if consumed < buffered {
            return Ok(());
        }
    }
}

fn peek_byte<R: BufRead>(reader: &mut R) -> std::io::Result<Option<u8>> {
    let buffer = reader.fill_buf()?;
    Ok(buffer.first().copied())
}

fn next_byte<R: BufRead>(reader: &mut R) -> std::io::Result<Option<u8>> {
    let byte = peek_byte(reader)?;
    if byte.is_some() {
        reader.consume(1);
    }
    Ok(byte)
}
