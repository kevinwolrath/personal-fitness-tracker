import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * #136: the health-sync enrollment key reaches release builds from the GitHub secret, local builds from .env.local,
 * and never lives in Git, an image layer or a log. These checks keep that wiring from silently breaking.
 */
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('enrollment key build wiring (#136)', () => {
  it('the Play workflow maps the secret, requires it and passes it into the build container by name only', () => {
    const wf = read('.github/workflows/google-play-internal.yml');
    expect(wf).toContain('BODY_ANVIL_ENROLLMENT_KEY: ${{ secrets.BODY_ANVIL_ENROLLMENT_KEY }}');
    expect(wf).toMatch(/\$required = @\([^)]*'BODY_ANVIL_ENROLLMENT_KEY'/);
    expect(wf).toContain('$env:EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY = $env:BODY_ANVIL_ENROLLMENT_KEY');
    expect(wf).toMatch(/--env EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY `/);
    expect(wf).not.toMatch(/--env EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY=/); // never the value on a command line
    expect(wf).not.toMatch(/(Write-Host|echo)[^\n]*ENROLLMENT_KEY/);
  });

  it('the release script refuses to build without it and checks the AAB carries it', () => {
    const sh = read('scripts/google-play-release.sh');
    expect(sh).toContain(': "${EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY:?');
    expect(sh).toContain('python3 /app/scripts/check-enrollment-key.py');
    expect(sh.indexOf('check-enrollment-key.py')).toBeLessThan(sh.indexOf('upload-play-bundle.js'));
    expect(sh).not.toMatch(/echo[^\n]*\$\{?EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY/);
  });

  it('local APKs take it as a BuildKit secret; env files never enter a Docker image', () => {
    expect(read('.dockerignore')).toMatch(/^\.env\.\*$/m);
    const docker = read('docker/android.Dockerfile');
    expect(docker).toContain('--mount=type=secret,id=body_anvil_enrollment_key');
    expect(docker).not.toMatch(/ARG EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY|ENV EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY/);
    expect(read('scripts/build-apk.ps1')).toContain('id=body_anvil_enrollment_key,env=$keyName');
  });

  it('no key in Git: local files are ignored and the example has no value', () => {
    expect(read('.gitignore')).toMatch(/^\.env\*\.local$/m);
    expect(read('.env.example')).toMatch(/^EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY=$/m);
  });

  it('the app reads it with the literal member access Expo inlines', () => {
    expect(read('src/healthSync/config.ts')).toContain('process.env.EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY');
  });

  const python = (() => {
    try {
      execFileSync('python3', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();
  (python ? it : it.skip)('the AAB check finds the key (UTF-8 or UTF-16) and fails without printing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pft-key-'));
    try {
      const make = (name: string, bundle: Buffer) => {
        const p = join(dir, name);
        const py = `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('base/assets/index.android.bundle', open(sys.argv[2],'rb').read())`;
        const raw = join(dir, `${name}.bin`);
        writeFileSync(raw, bundle);
        execFileSync('python3', ['-c', py, p, raw]);
        return p;
      };
      const key = 'placeholder-key-123';
      const run = (aab: string) => {
        try {
          return { code: 0, out: execFileSync('python3', [join(root, 'scripts/check-enrollment-key.py')], { env: { ...process.env, AAB: aab, EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY: key }, stdio: 'pipe' }).toString() };
        } catch (e) {
          const err = e as { status: number; stdout: Buffer; stderr: Buffer };
          return { code: err.status, out: `${err.stdout}${err.stderr}` };
        }
      };
      const ok = run(make('ok.aab', Buffer.from(`var a="${key}";`)));
      expect(ok.code).toBe(0);
      expect(run(make('u16.aab', Buffer.from(`x${key}y`, 'utf16le'))).code).toBe(0);
      const missing = run(make('no.aab', Buffer.from('var a="other";')));
      expect(missing.code).toBe(1);
      for (const r of [ok, missing]) expect(r.out).not.toContain(key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
