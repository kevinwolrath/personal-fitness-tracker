# Pinned (#91): the version the Google Play deploys built with, by digest, so a build never re-downloads or
# silently changes its toolchain. To upgrade, change the tag and digest here and in the other Android Dockerfile.
FROM reactnativecommunity/react-native-android:v22.0@sha256:e817ea1959719c97c05adbc55348ebe21d286cec2caed1f18ad3c4b88c08cbf7

# Lets the workflow prune only this project's old images, keeping the cached npm ci layer.
LABEL org.questspire.build=pft-google-play

WORKDIR /app

# Gradle's dependencies and build cache live here. The workflow mounts the named volume pft-gradle-cache at
# this path, so they survive between deploys (#91).
ENV GRADLE_USER_HOME=/gradle-cache

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
