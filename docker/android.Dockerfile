# Pinned (#91): the version the Google Play deploys built with, by digest, so a build never re-downloads or
# silently changes its toolchain. To upgrade, change the tag and digest here and in the other Android Dockerfile.
FROM reactnativecommunity/react-native-android:v22.0@sha256:e817ea1959719c97c05adbc55348ebe21d286cec2caed1f18ad3c4b88c08cbf7

WORKDIR /app

# Test APKs build for 64-bit ARM phones only, which skips three of the four native builds (#91). Pass
# --build-arg ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 (build-apk.ps1 -AllAbis) for an emulator or old phone.
ARG ANDROID_ABIS=arm64-v8a
ENV GRADLE_USER_HOME=/gradle-cache

# React Native 0.81 / Expo SDK 54 need Node 20.19.4 or newer. Fail early with a clear message.
RUN node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a<20||(a===20&&(b<19||(b===19&&c<4)))) { console.error('Node '+process.versions.node+' is too old: need >= 20.19.4'); process.exit(1) }"

COPY package.json package-lock.json ./
# BuildKit cache mounts (#91) keep npm's and Gradle's downloads between builds without putting them in the image.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

# Generate the native Android project from the Expo configuration.
# `android/` is excluded by .dockerignore, so this is always a clean prebuild.
RUN npx expo prebuild --platform android --no-install --non-interactive

# Build a RELEASE APK: a standalone app with the JS bundle (Hermes bytecode) embedded.
# Do not use assembleDebug: React Native never bundles JS into the "debug" variant
# (debuggableVariants), so a debug APK shows "Unable to load script" without Metro.
# Expo's generated project signs release with its debug keystore, so this APK still
# sideloads without Play Store credentials.
#
# #136: the health-sync enrollment key comes in as a BuildKit secret (scripts/build-apk.ps1 reads .env.local), so
# it is inlined into the APK's JS bundle but never stored in an image layer or its history. Optional: without it the
# test APK runs, but can't link a new phone to the sync server. ENROLLMENT_BUILD_REVISION (a short hash, not the
# key) only makes Docker rebuild this step when the key changes.
ARG ENROLLMENT_BUILD_REVISION=none
RUN --mount=type=cache,target=/gradle-cache \
    --mount=type=secret,id=body_anvil_enrollment_key,required=false \
    echo "enrollment build revision: $ENROLLMENT_BUILD_REVISION" && \
    if [ -s /run/secrets/body_anvil_enrollment_key ]; then \
      export EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY="$(cat /run/secrets/body_anvil_enrollment_key)"; \
    fi && \
    cd android && ./gradlew assembleRelease --no-daemon --build-cache -PreactNativeArchitectures=$ANDROID_ABIS

# Refuse to hand out an APK that would need Metro: the JS bundle must be inside it.
RUN APK=/app/android/app/build/outputs/apk/release/app-release.apk; \
    if [ ! -f "$APK" ]; then echo "No signed release APK at $APK"; ls -R /app/android/app/build/outputs/apk; exit 1; fi; \
    if ! (unzip -l "$APK" 2>/dev/null || jar tf "$APK") | grep -q 'assets/index.android.bundle'; then \
      echo "assets/index.android.bundle is missing from the APK: it would need Metro to start"; exit 1; \
    fi; \
    echo "OK: $APK contains assets/index.android.bundle"

CMD ["sh", "-c", "mkdir -p /output && cp /app/android/app/build/outputs/apk/release/app-release.apk /output/personal-fitness-tracker.apk"]
