# Build a sideloadable debug APK on this PC with Docker (no GitHub Actions, no runner).
# Usage, from the repo root in PowerShell:  ./scripts/build-apk.ps1
# Output: artifacts/personal-fitness-tracker.apk (git-ignored)
$ErrorActionPreference = 'Stop'
$tag = 'personal-fitness-tracker-android'
$out = Join-Path (Get-Location) 'artifacts'
New-Item -ItemType Directory -Force -Path $out | Out-Null

docker build --file docker/android.Dockerfile --tag $tag .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker run --rm --volume "${out}:/output" $tag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $out 'personal-fitness-tracker.apk'
if (-not (Test-Path $apk)) { throw 'APK was not produced' }
Get-Item $apk | Format-List Name, Length, LastWriteTime
