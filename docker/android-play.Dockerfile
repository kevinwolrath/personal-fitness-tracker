FROM reactnativecommunity/react-native-android:latest

WORKDIR /app

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
