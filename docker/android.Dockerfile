FROM reactnativecommunity/react-native-android:latest

WORKDIR /app

# React Native 0.81 / Expo SDK 54 need Node 20.19.4 or newer. Fail early with a clear message.
RUN node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a<20||(a===20&&(b<19||(b===19&&c<4)))) { console.error('Node '+process.versions.node+' is too old: need >= 20.19.4'); process.exit(1) }"

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate the native Android project from the Expo configuration.
# `android/` is excluded by .dockerignore, so this is always a clean prebuild.
RUN npx expo prebuild --platform android --no-install --non-interactive

# Build a RELEASE APK: a standalone app with the JS bundle (Hermes bytecode) embedded.
# Do not use assembleDebug: React Native never bundles JS into the "debug" variant
# (debuggableVariants), so a debug APK shows "Unable to load script" without Metro.
# Expo's generated project signs release with its debug keystore, so this APK still
# sideloads without Play Store credentials.
RUN cd android && ./gradlew assembleRelease --no-daemon

# Refuse to hand out an APK that would need Metro: the JS bundle must be inside it.
RUN APK=/app/android/app/build/outputs/apk/release/app-release.apk; \
    if [ ! -f "$APK" ]; then echo "No signed release APK at $APK"; ls -R /app/android/app/build/outputs/apk; exit 1; fi; \
    if ! (unzip -l "$APK" 2>/dev/null || jar tf "$APK") | grep -q 'assets/index.android.bundle'; then \
      echo "assets/index.android.bundle is missing from the APK: it would need Metro to start"; exit 1; \
    fi; \
    echo "OK: $APK contains assets/index.android.bundle"

CMD ["sh", "-c", "mkdir -p /output && cp /app/android/app/build/outputs/apk/release/app-release.apk /output/personal-fitness-tracker.apk"]
