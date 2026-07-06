use core_carddb::{CardDb, CardDbError};
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

const FIXTURE: &str = include_str!("fixtures/oracle_cards_fixture.json");
const FIXTURE_CARD_COUNT: usize = 20;
const FIXTURE_ARENA_ID_COUNT: usize = 14;

fn fixture_db() -> CardDb {
    let card_db = CardDb::open_in_memory().expect("in-memory card db should open");
    let stats = card_db
        .import_scryfall_bulk(FIXTURE.as_bytes())
        .expect("fixture import should succeed");
    assert_eq!(stats.imported_cards, FIXTURE_CARD_COUNT);
    card_db
}

fn temp_path(name: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("core-carddb-test-{timestamp}-{name}"))
}

/// Hands out at most three bytes per read call so the import path is proven
/// to work incrementally instead of relying on the whole input being
/// available at once.
struct TrickleReader<'a> {
    remaining: &'a [u8],
}

impl Read for TrickleReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let take = self.remaining.len().min(buffer.len()).min(3);
        buffer[..take].copy_from_slice(&self.remaining[..take]);
        self.remaining = &self.remaining[take..];
        Ok(take)
    }
}

#[test]
fn fixture_import_reports_row_and_skip_counts() {
    let card_db = CardDb::open_in_memory().expect("in-memory card db should open");
    let stats = card_db
        .import_scryfall_bulk(FIXTURE.as_bytes())
        .expect("fixture import should succeed");

    assert_eq!(stats.imported_cards, FIXTURE_CARD_COUNT);
    assert_eq!(stats.skipped_entries, 1, "the nameless entry must be skipped");

    let status = card_db.status().expect("status should load");
    assert_eq!(status.card_count, FIXTURE_CARD_COUNT);
    assert_eq!(status.with_arena_id_count, FIXTURE_ARENA_ID_COUNT);
}

#[test]
fn reimport_is_idempotent() {
    let card_db = fixture_db();
    let second_stats = card_db
        .import_scryfall_bulk(FIXTURE.as_bytes())
        .expect("second fixture import should succeed");

    assert_eq!(second_stats.imported_cards, FIXTURE_CARD_COUNT);
    let status = card_db.status().expect("status should load");
    assert_eq!(status.card_count, FIXTURE_CARD_COUNT);
    assert_eq!(status.with_arena_id_count, FIXTURE_ARENA_ID_COUNT);
}

#[test]
fn lookup_by_arena_id_returns_full_record() {
    let card_db = fixture_db();

    let bolt = card_db
        .lookup_by_arena_id(70001)
        .expect("lookup should succeed")
        .expect("Lightning Bolt should be present");
    assert_eq!(bolt.name, "Lightning Bolt");
    assert_eq!(bolt.scryfall_id, "11111111-1111-4111-8111-000000000001");
    assert_eq!(
        bolt.scryfall_oracle_id.as_deref(),
        Some("22222222-2222-4222-8222-000000000001")
    );
    assert_eq!(bolt.mana_cost.as_deref(), Some("{R}"));
    assert_eq!(bolt.cmc, Some(1.0));
    assert_eq!(bolt.type_line.as_deref(), Some("Instant"));
    assert_eq!(bolt.colors, vec!["R".to_owned()]);
    assert_eq!(bolt.set_code.as_deref(), Some("sta"));
    let legalities: serde_json::Value = serde_json::from_str(
        bolt.legalities_json.as_deref().expect("legalities stored"),
    )
    .expect("legalities should be valid JSON");
    assert_eq!(legalities["modern"], "legal");

    assert!(card_db
        .lookup_by_arena_id(99999)
        .expect("lookup should succeed")
        .is_none());
}

#[test]
fn lookup_by_name_is_exact_then_case_insensitive() {
    let card_db = fixture_db();

    let exact = card_db
        .lookup_by_name("Serra Angel")
        .expect("lookup should succeed")
        .expect("exact name should match");
    assert_eq!(exact.arena_id, Some(70007));
    assert_eq!(exact.keywords, vec!["Flying".to_owned(), "Vigilance".to_owned()]);

    let case_insensitive = card_db
        .lookup_by_name("sErRa aNgEl")
        .expect("lookup should succeed")
        .expect("case-insensitive name should match");
    assert_eq!(case_insensitive.scryfall_id, exact.scryfall_id);

    assert!(card_db
        .lookup_by_name("Card That Does Not Exist")
        .expect("lookup should succeed")
        .is_none());
}

#[test]
fn missing_optional_fields_are_tolerated() {
    let card_db = fixture_db();

    let minimal = card_db
        .lookup_by_name("Fixture Minimal Card")
        .expect("lookup should succeed")
        .expect("minimal card should be imported");
    assert_eq!(minimal.arena_id, None);
    assert_eq!(minimal.scryfall_oracle_id, None);
    assert_eq!(minimal.mana_cost, None);
    assert_eq!(minimal.cmc, None);
    assert_eq!(minimal.type_line, None);
    assert_eq!(minimal.oracle_text, None);
    assert!(minimal.colors.is_empty());
    assert!(minimal.keywords.is_empty());
    assert_eq!(minimal.legalities_json, None);
    assert_eq!(minimal.set_code, None);
}

#[test]
fn extra_fields_are_ignored() {
    let card_db = fixture_db();

    let elves = card_db
        .lookup_by_arena_id(70002)
        .expect("lookup should succeed")
        .expect("Llanowar Elves should be present despite extra fields");
    assert_eq!(elves.name, "Llanowar Elves");
    assert_eq!(elves.type_line.as_deref(), Some("Creature — Elf Druid"));
}

#[test]
fn import_streams_from_incremental_reader() {
    let card_db = CardDb::open_in_memory().expect("in-memory card db should open");
    let stats = card_db
        .import_scryfall_bulk(TrickleReader {
            remaining: FIXTURE.as_bytes(),
        })
        .expect("trickled import should succeed");

    assert_eq!(stats.imported_cards, FIXTURE_CARD_COUNT);
    assert_eq!(
        card_db.status().expect("status should load").card_count,
        FIXTURE_CARD_COUNT
    );
}

#[test]
fn import_tolerates_empty_array_and_rejects_non_array_input() {
    let card_db = CardDb::open_in_memory().expect("in-memory card db should open");

    let empty_stats = card_db
        .import_scryfall_bulk("[]".as_bytes())
        .expect("empty array should import cleanly");
    assert_eq!(empty_stats.imported_cards, 0);
    assert_eq!(empty_stats.skipped_entries, 0);

    let error = card_db
        .import_scryfall_bulk("{\"not\": \"an array\"}".as_bytes())
        .expect_err("non-array input should be rejected");
    assert!(matches!(error, CardDbError::Format(_)));

    let truncated = card_db
        .import_scryfall_bulk("[{\"id\": \"x\", \"name\": \"Y\"}".as_bytes())
        .expect_err("truncated array should be rejected");
    assert!(matches!(truncated, CardDbError::Format(_)));
}

#[test]
fn on_disk_database_persists_across_reopen() {
    let db_path = temp_path("cards.sqlite");

    {
        let card_db = CardDb::open(&db_path).expect("on-disk card db should open");
        let stats = card_db
            .import_scryfall_bulk(FIXTURE.as_bytes())
            .expect("fixture import should succeed");
        assert_eq!(stats.imported_cards, FIXTURE_CARD_COUNT);
    }

    let reopened = CardDb::open(&db_path).expect("card db should reopen");
    let teferi = reopened
        .lookup_by_arena_id(70010)
        .expect("lookup should succeed")
        .expect("Teferi should persist across reopen");
    assert_eq!(teferi.name, "Teferi, Hero of Dominaria");
    assert_eq!(teferi.colors, vec!["U".to_owned(), "W".to_owned()]);

    std::fs::remove_file(&db_path).expect("temporary card db should be removable");
}
