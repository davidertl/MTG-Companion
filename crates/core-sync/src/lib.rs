pub mod outbox;

pub use outbox::{
    backoff_delay, sync_outbox, BatchContext, BatchTransport, DrainConfig, DrainReport, Outbox,
    OutboxEventInput, OutboxRow, SyncBatch, SyncEventEnvelope, SyncProvenance, SyncSessionEnvelope,
    TransportOutcome,
};

use core_domain::SyncObject;

pub fn queue_sync_object(object_type: &str, object_id: &str, payload: serde_json::Value) -> SyncObject {
    SyncObject {
        object_type: object_type.to_owned(),
        object_id: object_id.to_owned(),
        payload,
        dirty: true,
        last_error: None,
    }
}

pub fn enqueue_local_update(object_type: &str, object_id: &str, payload: serde_json::Value) -> SyncObject {
    queue_sync_object(object_type, object_id, payload)
}

pub fn mark_sync_failed(mut sync_object: SyncObject, error: impl Into<String>) -> SyncObject {
    sync_object.dirty = true;
    sync_object.last_error = Some(error.into());
    sync_object
}

pub fn mark_sync_succeeded(mut sync_object: SyncObject) -> SyncObject {
    sync_object.dirty = false;
    sync_object.last_error = None;
    sync_object
}
