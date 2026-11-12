import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #160: both Android Dockerfiles pre-install the SDK parts the build uses, so Gradle never downloads them during a
 * build (parallel CMake installs raced and broke a Play deploy). If React Native changes its NDK, build-tools or
 * compile SDK, these must change with it, or the download (and the race) silently comes back.
 */
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const toml = read('node_modules/react-native/gradle/libs.versions.toml');
const version = (key: string) => toml.match(new RegExp(`^${key} = "([^"]+)"`, 'm'))![1];

describe.each(['docker/android-play.Dockerfile', 'docker/android.Dockerfile'])('%s', (file) => {
  const dockerfile = read(file);
  const packages = dockerfile.match(/^ARG ANDROID_SDK_PACKAGES="([^"]+)"/m)?.[1].split(' ') ?? [];

  it('pre-installs React Native’s NDK, build-tools and compile SDK, and AGP’s default CMake', () => {
    expect(packages).toEqual(expect.arrayContaining([
      `ndk;${version('ndkVersion')}`,
      `build-tools;${version('buildTools')}`,
      `platforms;android-${version('compileSdk')}`,
      'cmake;3.22.1',
    ]));
  });

  it('checks every installed part before the image is used, before npm ci (so the layer stays cached)', () => {
    for (const p of packages) {
      const [kind, v] = p.split(';');
      const dir = kind === 'platforms' ? `/opt/android/platforms/${v}` : `/opt/android/${kind}/${v}`;
      expect(dockerfile).toContain(dir);
    }
    const install = dockerfile.search(/^\s*sdkmanager --install/m);
    const npmCi = dockerfile.search(/^RUN .*npm ci/m);
    expect(install).toBeGreaterThan(-1);
    expect(npmCi).toBeGreaterThan(install);
  });
});
