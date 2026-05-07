# Overwolf Process Manager Plugin

`manifest.json` declares a placeholder `extra-objects.processManager` entry for sidecar startup.

Before packaging for release:

1. Obtain a compatible x64 Process Manager plugin DLL.
2. Place it at `apps/overwolf/public/plugins/ProcessManager.dll`.
3. Replace the manifest placeholder class value `TODO.REPLACE_WITH_PROCESS_MANAGER_PLUGIN_CLASS` with the real plugin class name from the DLL vendor documentation.

If no plugin is available, setup window still shows a manual fallback command:

`mancutg-arenac.exe serve --port 17890`
