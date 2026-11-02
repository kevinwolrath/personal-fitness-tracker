FROM reactnativecommunity/react-native-android:latest

WORKDIR /app

# Expo SDK 54 / React Native 0.81 require Node >= 20.19.4.
RUN node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a<20||(a===20&&(b<19||(b===19&&c<4)))) process.exit(1)"

# fastlane uploads the finished AAB directly to Google Play from this same container.
RUN apt-get update && apt-get install -y --no-install-recommends ruby-full build-essential && \
    gem install fastlane --no-document && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

COPY scripts/google-play-release.sh /usr/local/bin/google-play-release
RUN chmod +x /usr/local/bin/google-play-release

ENTRYPOINT ["google-play-release"]
