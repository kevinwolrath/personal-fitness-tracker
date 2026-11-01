# Build a standalone, sideloadable RELEASE APK on this PC with Docker (no GitHub Actions, no runner).
# The JS bundle is embedded, so the app starts without Metro, USB or a dev server.
# Usage, from the repo root in PowerShell:  ./scripts/build-apk.ps1   (add -NoCache for a fully clean build)
# Output: artifacts/personal-fitness-tracker.apk (git-ignored)
param([switch]$NoCache)
$ErrorActionPreference = 'Stop'
$tag = 'personal-fitness-tracker-android'
$out = Join-Path (Get-Location) 'artifacts'
$apk = Join-Path $out 'personal-fitness-tracker.apk'
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Never leave an old APK (e.g. a Metro-only debug build) lying around to be installed by mistake.
if (Test-Path $apk) { Remove-Item $apk }

$buildArgs = @('build', '--file', 'docker/android.Dockerfile', '--tag', $tag)
if ($NoCache) { $buildArgs += '--no-cache' }
docker @buildArgs .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker run --rm --volume "${out}:/output" $tag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path $apk)) { throw 'APK was not produced' }

# Same check as the image, on the file you'll install: the JS bundle must be inside the APK.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
try { $bundle = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' } } finally { $zip.Dispose() }
if (-not $bundle) { throw 'assets/index.android.bundle is missing: this APK would need Metro to start' }

Get-Item $apk | Format-List Name, Length, LastWriteTime
Write-Host "Standalone release APK with embedded JS bundle ($([math]::Round($bundle.Length / 1MB, 1)) MB)."
