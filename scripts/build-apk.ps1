# Build a standalone, sideloadable RELEASE APK on this PC with Docker (no GitHub Actions, no runner).
# The JS bundle is embedded, so the app starts without Metro, USB or a dev server.
# Usage, from the repo root in PowerShell:  ./scripts/build-apk.ps1   (add -NoCache to rebuild every step)
# The APK is for 64-bit ARM phones (arm64-v8a); add -AllAbis for an emulator or an old 32-bit phone.
# Output: artifacts/personal-fitness-tracker.apk (git-ignored)
param([switch]$NoCache, [switch]$AllAbis)
$ErrorActionPreference = 'Stop'
$tag = 'personal-fitness-tracker-android'
$out = Join-Path (Get-Location) 'artifacts'
$apk = Join-Path $out 'personal-fitness-tracker.apk'
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Never leave an old APK (e.g. a Metro-only debug build) lying around to be installed by mistake.
if (Test-Path $apk) { Remove-Item $apk }

# BuildKit is needed for the Dockerfile's cache mounts, which keep npm and Gradle downloads between builds.
$env:DOCKER_BUILDKIT = '1'
$buildArgs = @('build', '--file', 'docker/android.Dockerfile', '--tag', $tag)

# #136: the health-sync enrollment key, from the environment or .env.local (git-ignored). Passed as a BuildKit
# secret, so it's inlined into the APK's JS bundle but never stored in the image. Never printed.
$keyName = 'EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY'
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($keyName)) -and (Test-Path '.env.local')) {
  foreach ($line in Get-Content '.env.local') {
    if ($line -match "^\s*$keyName\s*=\s*(.*?)\s*$") { [Environment]::SetEnvironmentVariable($keyName, $Matches[1].Trim('"', "'")) }
  }
}
$key = [Environment]::GetEnvironmentVariable($keyName)
if ([string]::IsNullOrWhiteSpace($key)) {
  Write-Warning "$keyName is not set (environment or .env.local): this APK can't link a new phone to the sync server."
} else {
  $sha = [Security.Cryptography.SHA256]::Create()
  $fingerprint = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))[0..5] | ForEach-Object { $_.ToString('x2') })
  $buildArgs += @('--secret', "id=body_anvil_enrollment_key,env=$keyName", '--build-arg', "ENROLLMENT_BUILD_REVISION=$fingerprint")
  Write-Host 'Enrollment key: set (value not shown).'
}
# -NoCache rebuilds every step (clean prebuild and Gradle build); downloaded npm and Gradle packages stay cached.
if ($NoCache) { $buildArgs += '--no-cache' }
if ($AllAbis) { $buildArgs += @('--build-arg', 'ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64') }
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
