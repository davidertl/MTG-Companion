#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "gui")]
    {
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![
                mancutg_arenac::commands::bootstrap,
                mancutg_arenac::commands::watch_log,
                mancutg_arenac::commands::inspect_store,
                mancutg_arenac::commands::show_settings,
                mancutg_arenac::commands::set_consent,
                mancutg_arenac::commands::import_ios_file,
                mancutg_arenac::commands::import_ios_folder,
                mancutg_arenac::commands::export_backup,
            ])
            .run(tauri::generate_context!())
            .expect("error running MancuTG-ArenaC");
    }

    #[cfg(not(feature = "gui"))]
    {
        eprintln!("Built without the 'gui' feature. Run with --features gui to open the desktop window.");
        std::process::exit(1);
    }
}
