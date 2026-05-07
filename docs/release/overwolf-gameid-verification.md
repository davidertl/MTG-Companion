# Overwolf Game ID Verification (ArenaC)

## Verify `game_targeting` ID 21566

Run on a Windows machine with Overwolf installed:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Overwolf" -Filter "gamelist*.xml" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
```

Then:

1. Open the newest `gamelist*.xml`.
2. Search for MTG Arena.
3. Confirm the matching Overwolf Game ID is `21566`.
4. Verify `apps/overwolf/public/manifest.json` uses the same value in:
   - `data.game_targeting.game_ids`
   - `data.launch_events.game_launch`
5. Rebuild package with `pwsh scripts/package-overwolf.ps1`.

## Outstanding Assets

The following manifest-required assets are referenced but currently missing from `apps/overwolf/public/assets/`:

- `assets/IconMouseOver.png`
- `assets/IconMouseNormal.png`
- `assets/launcher_icon.ico`
- `assets/window_icon.png`
- `assets/splash.png`

`scripts/package-overwolf.ps1` now fails fast until these assets are added.
