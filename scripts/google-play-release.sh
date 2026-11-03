#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
: "${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required}"
: "${ANDROID_KEY_PASSWORD:?ANDROID_KEY_PASSWORD is required}"
: "${ANDROID_VERSION_CODE:?ANDROID_VERSION_CODE is required}"
: "${GOOGLE_PLAY_SERVICE_ACCOUNT_FILE:?GOOGLE_PLAY_SERVICE_ACCOUNT_FILE is required}"

KEYSTORE=/run/secrets/personal-fitness-tracker-upload.jks
[ -f "$KEYSTORE" ] || { echo "Upload keystore is missing" >&2; exit 1; }
[ -f "$GOOGLE_PLAY_SERVICE_ACCOUNT_FILE" ] || { echo "Google Play service account file is missing" >&2; exit 1; }

PACKAGE=com.questspire.personalfitnesstracker
TRACK=internal

echo "Google Play target: package=$PACKAGE track=$TRACK versionCode=$ANDROID_VERSION_CODE"
echo "Generating clean Android project..."
CI=1 npx expo prebuild --platform android --no-install

# Expo's generated release config uses the debug key by default. Replace it with a
# signing config whose secrets are supplied only at container runtime.
python3 - <<'PY'
from pathlib import Path
p = Path('android/app/build.gradle')
s = p.read_text()
needle = '''        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
'''
if needle not in s:
    raise SystemExit('Expected Expo debug signingConfig was not found; refusing to guess')
replacement = needle + '''        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
'''
s = s.replace(needle, replacement, 1)
# Point the RELEASE build type at the upload key. Expo's template also has a debug build type with the same
# line, and it comes first, so replacing the first match would leave the release AAB signed with the debug key.
import re
build_types = s.index('buildTypes {')
release_type = re.compile(r'(\n\s*release\s*\{[^}]*?)signingConfig signingConfigs\.debug')
m = release_type.search(s, build_types)
if not m:
    raise SystemExit('Expected Expo release signingConfig was not found; refusing to guess')
s = s[:m.start()] + m.group(1) + 'signingConfig signingConfigs.release' + s[m.end():]
# Override generated versionCode without changing the user-facing app version.
s = s.replace('versionCode 1', f'versionCode {__import__("os").environ["ANDROID_VERSION_CODE"]}', 1)
p.write_text(s)
PY

# Verify the generated Gradle project BEFORE the long build, so a mismatch fails in seconds.
# Expo writes Groovy strings with single quotes; accept either quote style.
GRADLE=android/app/build.gradle
require_gradle() {
  if ! grep -Eq "$1" "$GRADLE"; then
    echo "$2; refusing to build" >&2
    grep -nE "$3" "$GRADLE" >&2 || true
    exit 1
  fi
}
require_gradle "applicationId[[:space:]]+['\"]${PACKAGE//./\\.}['\"]" "Unexpected Android applicationId" 'applicationId'
require_gradle "versionCode[[:space:]]+${ANDROID_VERSION_CODE}([^0-9]|\$)" "Generated versionCode is not $ANDROID_VERSION_CODE" 'versionCode'
# The release build type itself (not the debug one) must use the upload key.
RELEASE_SIGNING=$(awk '/buildTypes[[:space:]]*\{/{bt=1} bt && /^[[:space:]]*release[[:space:]]*\{/{rel=1} rel && /signingConfig[[:space:]]/{print $2; exit}' "$GRADLE")
if [ "$RELEASE_SIGNING" != "signingConfigs.release" ]; then
  echo "Release build type is signed with '${RELEASE_SIGNING:-nothing}', not the upload key; refusing to build" >&2
  exit 1
fi

export ANDROID_KEYSTORE_FILE="$KEYSTORE"
cd android
./gradlew bundleRelease --no-daemon
cd ..

AAB=/app/android/app/build/outputs/bundle/release/app-release.aab
[ -f "$AAB" ] || { echo "Release AAB not found at $AAB" >&2; exit 1; }

echo "Uploading signed AAB to Google Play INTERNAL testing only..."
# Resumable, chunked upload that survives dropped connections (scripts/upload-play-bundle.js). The track is
# fixed to internal inside that script; an app that has never been published gets a DRAFT internal release.
AAB_PATH="$AAB" ANDROID_PACKAGE_NAME="$PACKAGE" node /app/scripts/upload-play-bundle.js
echo "Google Play internal upload complete."
