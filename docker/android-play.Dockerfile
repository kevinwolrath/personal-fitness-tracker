# Pinned (#91): the version the Google Play deploys built with, by digest, so a build never re-downloads or
# silently changes its toolchain. To upgrade, change the tag and digest here and in the other Android Dockerfile.
FROM reactnativecommunity/react-native-android:v22.0@sha256:e817ea1959719c97c05adbc55348ebe21d286cec2caed1f18ad3c4b88c08cbf7

# Lets the workflow prune only this project's old images, keeping the cached npm ci layer.
LABEL org.questspire.build=pft-google-play

WORKDIR /app

# Gradle's dependencies and build cache live here. The workflow mounts the named volume pft-gradle-cache at
# this path, so they survive between deploys (#91).
ENV GRADLE_USER_HOME=/gradle-cache

# #160: the Android SDK parts this project builds with, installed once into the image. The base image ships other
# versions (CMake 3.30.5, NDK 28.2, build-tools 37), so without this Gradle downloads these on every build, in parallel
# tasks: two CMake installs raced and one read a half-written zip ("Archive is not a ZIP archive"). A failed download
# fails this layer, which is then never cached. Before npm ci, so the layer stays cached until a version changes.
# Versions: NDK, build-tools 36 and platform 36 from react-native/gradle/libs.versions.toml (checked by
# src/repo/__tests__/androidSdk.test.ts); CMake 3.22.1 and build-tools 35 are the Android Gradle plugin's defaults.
ARG ANDROID_SDK_PACKAGES="cmake;3.22.1 ndk;27.1.12297006 build-tools;35.0.0 build-tools;36.0.0 platforms;android-36"
RUN yes | sdkmanager --licenses > /dev/null && \
    sdkmanager --install $ANDROID_SDK_PACKAGES > /tmp/sdkmanager.log 2>&1 || { tail -n 50 /tmp/sdkmanager.log; exit 1; }; \
    /opt/android/cmake/3.22.1/bin/cmake --version && \
    test -f /opt/android/ndk/27.1.12297006/source.properties && \
    test -d /opt/android/build-tools/35.0.0 && test -d /opt/android/build-tools/36.0.0 && \
    test -f /opt/android/platforms/android-36/android.jar && \
    rm -f /tmp/sdkmanager.log

# Expo SDK 54 / React Native 0.81 require Node >= 20.19.4.
RUN node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a<20||(a===20&&(b<19||(b===19&&c<4)))) process.exit(1)"

# The finished AAB is uploaded from this same container by scripts/upload-play-bundle.js (Node, no fastlane).

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

COPY scripts/google-play-release.sh /usr/local/bin/google-play-release
# The repo is checked out on Windows, so normalise CRLF -> LF before executing.
RUN sed -i 's/\r$//' /usr/local/bin/google-play-release && \
    chmod +x /usr/local/bin/google-play-release

ENTRYPOINT ["google-play-release"]
