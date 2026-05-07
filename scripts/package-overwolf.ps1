# Package Overwolf dist + release binary into an OPK.
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
    npm ci
    npm run build
    Pop-Location
}

$ManifestSource = Join-Path $Root "apps/overwolf/public/manifest.json"
$PluginsSource = Join-Path $Root "apps/overwolf/public/plugins"

$RequiredManifestAssets = @(
    "assets/IconMouseOver.png",
    "assets/IconMouseNormal.png",
    "assets/launcher_icon.ico",
    "assets/window_icon.png",
    "assets/splash.png"
)

if (-not (Test-Path $ManifestSource)) {
    throw "Missing manifest source: $ManifestSource"
}

$Manifest = Get-Content $ManifestSource -Raw | ConvertFrom-Json
foreach ($AssetPath in $RequiredManifestAssets) {
    $AssetFsPath = Join-Path (Join-Path $Root "apps/overwolf/public") $AssetPath
    if (-not (Test-Path $AssetFsPath)) {
        throw "Missing required manifest asset: $AssetPath"
    }
}

$Stage = Join-Path $Root "dist-opk"
if (Test-Path $Stage) {
    Remove-Item $Stage -Recurse -Force
}
New-Item -ItemType Directory -Path $Stage | Out-Null
Copy-Item -Path (Join-Path $Dist "*") -Destination $Stage -Recurse -Force
Copy-Item -Path $ManifestSource -Destination (Join-Path $Stage "manifest.json") -Force

$StageBin = Join-Path $Stage "bin"
New-Item -ItemType Directory -Force -Path $StageBin | Out-Null
Copy-Item -Path $ReleaseExe -Destination (Join-Path $StageBin "mancutg-arenac.exe") -Force

if (Test-Path $PluginsSource) {
    Copy-Item -Path $PluginsSource -Destination (Join-Path $Stage "plugins") -Recurse -Force
}

$PackageName = "mancutg-arenac-overwolf-0.1.0"
$Zip = Join-Path $Root "$PackageName.zip"
$Opk = Join-Path $Root "$PackageName.opk"
if (Test-Path $Zip) {
    Remove-Item $Zip -Force
}
if (Test-Path $Opk) {
    Remove-Item $Opk -Force
}
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -CompressionLevel Fastest -Force
Move-Item -Path $Zip -Destination $Opk
Write-Host "Created $Opk"
