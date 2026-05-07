# Package Overwolf dist + release binary into a zip (rename to .opk for sideload).
# Run from repo root on Windows after Rust + Node are installed.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$ReleaseExe = Join-Path $Root "target/release/mancutg-arenac.exe"
if (-not (Test-Path $ReleaseExe)) {
    Write-Host "Building mancutg-arenac (release)..."
    cargo build -p mancutg-arenac --release
}

$Dist = Join-Path $Root "apps/overwolf/dist"
if (-not (Test-Path $Dist)) {
    Write-Host "Building Overwolf web bundle..."
    Push-Location (Join-Path $Root "apps/overwolf")
    npm install
    npm run build
    Pop-Location
}

$Stage = Join-Path $Root "dist-opk"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item -Path (Join-Path $Dist "*") -Destination $Stage -Recurse -Force
Copy-Item -Path $ReleaseExe -Destination (Join-Path $Stage "mancutg-arenac.exe") -Force

$Zip = Join-Path $Root "mancutg-arenac-overwolf-0.1.0.zip"
if (Test-Path $Zip) {
    Remove-Item $Zip -Force
}
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -Force
Write-Host "Created $Zip — rename to .opk for Overwolf sideload if needed."
