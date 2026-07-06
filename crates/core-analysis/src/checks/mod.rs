//! One module per rule check. Every check exposes a `check(&CheckContext) ->
//! Vec<Finding>` function that walks the timeline deterministically and emits
//! findings whose `severity` never exceeds `possible-violation`. Each module's
//! doc comment states the check's fire condition and its known blind spots.

pub(crate) mod extra_land_drop;
pub(crate) mod illegal_attack;
pub(crate) mod mana_impossible;
pub(crate) mod missed_trigger_hint;
pub(crate) mod sba_lethal_damage;
pub(crate) mod timing_violation;
