use mancutg_arenac::{
    load_arena_settings, reset_arena_settings, set_consent, wipe_local_data,
};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_path(name: &str, extension: &str) -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mancutg-arenac-{name}-{timestamp}.{extension}"))
}

#[test]
fn persists_and_loads_settings_defaults_and_consent() {
    let settings_path = temp_path("settings", "json");

    let defaults = load_arena_settings(Some(settings_path.to_string_lossy().as_ref()))
        .expect("default settings should load");
    assert!(!defaults.privacy.telemetry_enabled);
    assert_eq!(defaults.privacy.allowed_purposes, vec!["updates".to_owned()]);

    let updated = set_consent(
        "telemetry",
        true,
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("telemetry consent should persist");
    assert!(updated.privacy.telemetry_enabled);

    let reloaded = load_arena_settings(Some(settings_path.to_string_lossy().as_ref()))
        .expect("settings should reload");
    assert!(reloaded.privacy.telemetry_enabled);
    assert!(reloaded
        .privacy
        .allowed_purposes
        .contains(&"telemetry".to_owned()));

    std::fs::remove_file(settings_path).expect("temporary settings file should be removable");
}

#[test]
fn can_reset_settings_and_wipe_local_data_files() {
    let settings_path = temp_path("settings-reset", "json");
    let store_path = temp_path("store-reset", "sqlite3");

    set_consent(
        "archidekt",
        true,
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("archidekt consent should persist");
    std::fs::write(&store_path, "placeholder").expect("store placeholder should exist");

    let reset = reset_arena_settings(Some(settings_path.to_string_lossy().as_ref()))
        .expect("settings should reset");
    assert_eq!(reset.privacy.allowed_purposes, vec!["updates".to_owned()]);

    let removal = wipe_local_data(
        Some(store_path.to_string_lossy().as_ref()),
        Some(settings_path.to_string_lossy().as_ref()),
    )
    .expect("local data wipe should succeed");
    assert!(removal.removed_store_file);
    assert!(removal.removed_settings_file);
}
