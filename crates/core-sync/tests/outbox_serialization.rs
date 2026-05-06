use core_sync::{mark_sync_failed, queue_sync_object};

#[test]
fn serializes_outbox_objects_without_losing_dirty_state() {
    let queued = queue_sync_object(
        "deck_snapshot",
        "deck-1",
        serde_json::json!({
            "name": "Azorius Control",
            "cards": [{"name": "No More Lies", "quantity": 4}]
        }),
    );

    assert!(queued.dirty);
    assert!(queued.last_error.is_none());

    let failed = mark_sync_failed(queued.clone(), "backend unavailable");
    assert_eq!(failed.last_error.as_deref(), Some("backend unavailable"));
    assert!(failed.dirty);

    let json = serde_json::to_string(&failed).expect("sync object should serialize");
    assert!(json.contains("\"objectType\""));
    assert!(json.contains("\"objectId\""));
    assert!(json.contains("\"lastError\""));
    let restored: core_domain::SyncObject =
        serde_json::from_str(&json).expect("sync object should deserialize");

    assert_eq!(restored.object_type, "deck_snapshot");
    assert_eq!(restored.object_id, "deck-1");
    assert!(restored.dirty);
}
