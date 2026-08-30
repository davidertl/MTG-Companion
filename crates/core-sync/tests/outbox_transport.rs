//! W4.3 outbox transport semantics: enqueue → drain → ack, retry-with-backoff
//! idempotency, and the consent hard gate. The transport is a mock closure
//! that models the backend `/events` idempotency behavior, so no socket is
//! opened.

use core_sync::{
    backoff_delay, sync_outbox, DrainConfig, Outbox, OutboxEventInput, SyncBatch, TransportOutcome,
};
use serde_json::json;
use std::cell::RefCell;
use std::collections::HashSet;
use std::time::Duration;

fn sample_events(count: u64) -> Vec<OutboxEventInput> {
    (0..count)
        .map(|sequence| OutboxEventInput {
            session_id: "session-a".to_owned(),
            sequence,
            event_type: "CARD_CAST".to_owned(),
            occurred_at: format!("2026-07-06T00:00:0{sequence}Z"),
            payload: json!({ "match_id": "match-1", "seq": sequence }),
        })
        .collect()
}

/// Test double for the backend: applies each batch's events, deduplicating by
/// the batch `idempotencyKey` (mirroring `applyBackendEventBatch`), and returns
/// a scripted status per call so we can drive retries.
struct MockBackend {
    seen_keys: RefCell<HashSet<String>>,
    applied_event_ids: RefCell<Vec<String>>,
    calls: RefCell<usize>,
    /// One outcome per call; the last entry repeats if calls exceed the script.
    script: Vec<TransportOutcome>,
    /// When true, the batch is "stored" even on a Retryable response (models a
    /// server that persisted the rows but whose ack was lost).
    apply_on_retryable: bool,
}

impl MockBackend {
    fn new(script: Vec<TransportOutcome>, apply_on_retryable: bool) -> Self {
        Self {
            seen_keys: RefCell::new(HashSet::new()),
            applied_event_ids: RefCell::new(Vec::new()),
            calls: RefCell::new(0),
            script,
            apply_on_retryable,
        }
    }

    fn handle(&self, batch: &SyncBatch) -> TransportOutcome {
        let call_index = {
            let mut calls = self.calls.borrow_mut();
            let index = *calls;
            *calls += 1;
            index
        };
        let outcome = self
            .script
            .get(call_index)
            .cloned()
            .unwrap_or(TransportOutcome::Success);

        let should_apply = matches!(outcome, TransportOutcome::Success)
            || (self.apply_on_retryable && matches!(outcome, TransportOutcome::Retryable(_)));

        if should_apply {
            // Idempotent apply: only the first batch with a given key lands.
            if self.seen_keys.borrow_mut().insert(batch.idempotency_key.clone()) {
                for event in &batch.events {
                    self.applied_event_ids
                        .borrow_mut()
                        .push(event.event_id.clone());
                }
            }
        }

        outcome
    }
}

fn fast_config() -> DrainConfig {
    DrainConfig {
        base_backoff: Duration::ZERO,
        ..DrainConfig::default()
    }
}

#[test]
fn enqueue_then_drain_marks_events_synced() {
    let outbox = Outbox::open_in_memory().expect("outbox opens");
    let inserted = outbox.enqueue(&sample_events(3)).expect("enqueue succeeds");
    assert_eq!(inserted, 3);
    assert_eq!(outbox.pending_count().unwrap(), 3);

    let backend = MockBackend::new(vec![TransportOutcome::Success], false);
    let report = sync_outbox(
        &outbox,
        true,
        |batch: &SyncBatch, _body: &str| backend.handle(batch),
        &fast_config(),
    )
    .expect("drain succeeds");

    assert!(report.attempted);
    assert_eq!(report.events_synced, 3);
    assert_eq!(report.batches_sent, 1);
    assert_eq!(outbox.pending_count().unwrap(), 0);
    assert_eq!(outbox.synced_count().unwrap(), 3);

    // Re-enqueue is idempotent (same event_ids) and a second drain has nothing
    // left to send.
    assert_eq!(outbox.enqueue(&sample_events(3)).unwrap(), 0);
    let second = sync_outbox(
        &outbox,
        true,
        |batch: &SyncBatch, _body: &str| backend.handle(batch),
        &fast_config(),
    )
    .unwrap();
    assert_eq!(second.events_synced, 0);
}

#[test]
fn server_500_retries_with_backoff_without_duplicate_rows() {
    let outbox = Outbox::open_in_memory().expect("outbox opens");
    outbox.enqueue(&sample_events(2)).expect("enqueue succeeds");

    // First two attempts fail with 500 but the server actually persisted the
    // batch (ack lost); the third succeeds. Because every attempt reuses the
    // same idempotencyKey, the server deduplicates and stores each event once.
    let backend = MockBackend::new(
        vec![
            TransportOutcome::Retryable("500".to_owned()),
            TransportOutcome::Retryable("500".to_owned()),
            TransportOutcome::Success,
        ],
        true,
    );

    let report = sync_outbox(
        &outbox,
        true,
        |batch: &SyncBatch, _body: &str| backend.handle(batch),
        &fast_config(),
    )
    .expect("drain eventually succeeds");

    assert_eq!(report.transport_calls, 3, "two retries then success");
    assert_eq!(report.events_synced, 2);
    assert_eq!(outbox.pending_count().unwrap(), 0);

    // The crux: no duplicate server rows despite the retries.
    let applied = backend.applied_event_ids.borrow();
    assert_eq!(applied.len(), 2, "each event applied exactly once");
    let unique: HashSet<&String> = applied.iter().collect();
    assert_eq!(unique.len(), 2, "no duplicate event ids server-side");

    // Retried batches reused a single idempotency key.
    assert_eq!(backend.seen_keys.borrow().len(), 1);
}

#[test]
fn consent_off_accumulates_outbox_with_zero_network_attempts() {
    let outbox = Outbox::open_in_memory().expect("outbox opens");
    outbox.enqueue(&sample_events(4)).expect("enqueue succeeds");

    let transport_calls = RefCell::new(0usize);
    let report = sync_outbox(
        &outbox,
        false, // consent OFF — hard gate
        |_batch: &SyncBatch, _body: &str| {
            *transport_calls.borrow_mut() += 1;
            TransportOutcome::Success
        },
        &fast_config(),
    )
    .expect("gated sync returns without error");

    assert!(!report.attempted, "sync was not attempted");
    assert_eq!(report.transport_calls, 0);
    assert_eq!(*transport_calls.borrow(), 0, "zero network attempts");
    // Outbox still accumulates for a future (consented) drain.
    assert_eq!(outbox.pending_count().unwrap(), 4);
    assert_eq!(outbox.synced_count().unwrap(), 0);
}

#[test]
fn backoff_delay_grows_exponentially() {
    let base = Duration::from_millis(100);
    assert_eq!(backoff_delay(base, 0), Duration::from_millis(100));
    assert_eq!(backoff_delay(base, 1), Duration::from_millis(200));
    assert_eq!(backoff_delay(base, 2), Duration::from_millis(400));
    assert_eq!(backoff_delay(Duration::ZERO, 3), Duration::ZERO);
}

#[test]
fn permanent_4xx_failure_is_not_retried_and_leaves_rows_pending() {
    let outbox = Outbox::open_in_memory().expect("outbox opens");
    outbox.enqueue(&sample_events(1)).expect("enqueue succeeds");

    let backend = MockBackend::new(vec![TransportOutcome::Permanent("400".to_owned())], false);
    let report = sync_outbox(
        &outbox,
        true,
        |batch: &SyncBatch, _body: &str| backend.handle(batch),
        &fast_config(),
    )
    .expect("drain returns");

    assert_eq!(report.transport_calls, 1, "4xx is not retried");
    assert_eq!(report.events_synced, 0);
    assert_eq!(report.failed_events, 1);
    assert_eq!(outbox.pending_count().unwrap(), 1, "row stays pending");
}
