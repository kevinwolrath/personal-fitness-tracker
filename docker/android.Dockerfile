FROM reactnativecommunity/react-native-android:latest

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate the native Android project from the Expo configuration, then build
# a debug APK. Debug signing is intentional: this workflow is for direct
# sideload/testing and does not require Play Store credentials.
RUN npx expo prebuild --platform android --no-install --non-interactive
RUN cd android && ./gradlew assembleDebug --no-daemon

CMD ["sh", "-c", "mkdir -p /output && cp /app/android/app/build/outputs/apk/debug/app-debug.apk /output/personal-fitness-tracker.apk"]
