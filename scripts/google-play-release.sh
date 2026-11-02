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
npx expo prebuild --platform android --no-install --non-interactive

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
old = 'signingConfig signingConfigs.debug'
if old not in s:
    raise SystemExit('Expected Expo release signingConfig was not found; refusing to guess')
s = s.replace(old, 'signingConfig signingConfigs.release', 1)
# Override generated versionCode without changing the user-facing app version.
s = s.replace('versionCode 1', f'versionCode {__import__("os").environ["ANDROID_VERSION_CODE"]}', 1)
p.write_text(s)
PY

export ANDROID_KEYSTORE_FILE="$KEYSTORE"
cd android
./gradlew bundleRelease --no-daemon
cd ..

AAB=/app/android/app/build/outputs/bundle/release/app-release.aab
[ -f "$AAB" ] || { echo "Release AAB not found at $AAB" >&2; exit 1; }

# Verify the generated Gradle project still targets the immutable Play package.
grep -q 'applicationId "com.questspire.personalfitnesstracker"' android/app/build.gradle || {
  echo "Unexpected Android applicationId; refusing to upload" >&2; exit 1;
}

echo "Uploading signed AAB to Google Play INTERNAL testing only..."
fastlane supply \
  --aab "$AAB" \
  --package_name "$PACKAGE" \
  --track "$TRACK" \
  --json_key "$GOOGLE_PLAY_SERVICE_ACCOUNT_FILE" \
  --skip_upload_apk true \
  --skip_upload_metadata true \
  --skip_upload_images true \
  --skip_upload_screenshots true

echo "Google Play internal upload complete."
