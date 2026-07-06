# GRE detailed-log fixture corpus

Fixtures in this directory drive the play-level MTGA parser tests
(`crates/core-parser/tests/gre_play_level.rs`).

## Naming convention

- `<scenario>__<expectation>.log` — e.g. `single_cast__creature_resolves.log`
- Files prefixed with `synthetic__` were hand-authored to match the documented
  GRE message shapes and are NOT captured from a real client. They keep the
  parser testable until real samples land, but must not be treated as ground
  truth for format drift.
- Files without the prefix are sanitized excerpts from real `Player.log`
  captures and take precedence when the two disagree.

## How to export a real sample (repo owner action)

1. In MTG Arena: Options → Account → enable **Detailed Logs (Plugin Support)**.
2. Play one match, then close Arena.
3. Locate `Player.log`:
   - Windows: `%AppData%\..\LocalLow\Wizards Of The Coast\MTGA\Player.log`
   - macOS: `~/Library/Logs/Wizards Of The Coast/MTGA/Player.log`
4. Sanitize before committing: remove or replace account ids, screen names,
   and any `authenticate`/token lines. Keep the `[UnityCrossThreadLogger]`
   prefixes and JSON payload structure intact — the parser must cope with the
   real framing.
5. Name the file after the scenario it exercises and add the expected event
   summary to the corresponding golden test.
