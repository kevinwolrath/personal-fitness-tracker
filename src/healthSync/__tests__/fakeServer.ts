/**
 * An in-memory stand-in for the Questspire Studio health API (#134), following docs/health-sync-api.md, so the app can
 * be tested before the real backend exists. Records every request (with the Authorization header) for leak checks.
 */
type Req = { method: string; url: string; headers: Record<string, string>; body?: string };
type Share = { shareId: string; token: string; userId: string; createdAt: string; expiresAt: string; revokedAt: string | null; scope: unknown; document: unknown; bytes: number };

export class FakeHealthServer {
  requests: Req[] = [];
  users = new Map<string, { secret: string; token: string; snapshot: { body: string; etag: string; uploadedAt: string } | null }>();
  shares: Share[] = [];
  offline = false;
  failNext: number | null = null;
  /** Drop the response of the next enroll after storing it (an interrupted request). */
  dropNextEnrollResponse = false;
  now = '2026-11-12T00:00:00.000Z';
  private n = 0;

  fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    this.requests.push({ method: init.method, url, headers: init.headers, body: init.body });
    if (this.offline) throw new TypeError('Network request failed');
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return res(status, { error: { code: 'fail' } }, { 'Retry-After': '30' });
    }
    const u = new URL(url);
    const path = u.pathname;
    const auth = init.headers.Authorization?.replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (init.method === 'POST' && path === '/api/health/v1/enroll') {
      const existing = this.users.get(body.userId);
      if (existing && existing.secret !== body.enrollmentSecret) return res(409, { error: { code: 'already_enrolled' } });
      const user = existing ?? { secret: body.enrollmentSecret, token: `owner-${++this.n}-${'x'.repeat(24)}`, snapshot: null };
      user.snapshot = { body: JSON.stringify(body.snapshot), etag: `"e${++this.n}"`, uploadedAt: this.now };
      this.users.set(body.userId, user);
      if (this.dropNextEnrollResponse) {
        this.dropNextEnrollResponse = false;
        throw new TypeError('Network request failed');
      }
      return res(existing ? 200 : 201, { userId: body.userId, ownerToken: user.token, snapshot: receipt(user.snapshot) });
    }
    const m = path.match(/^\/api\/health\/v1\/users\/([^/]+)\/(snapshot|shares)(?:\/([^/]+))?$/);
    if (m) {
      const user = this.users.get(decodeURIComponent(m[1]));
      if (!auth || !user || user.token !== auth) return res(401, { error: { code: 'unauthorized' } });
      const userId = decodeURIComponent(m[1]);
      if (m[2] === 'snapshot' && init.method === 'PUT') {
        user.snapshot = { body: init.body!, etag: `"e${++this.n}"`, uploadedAt: this.now };
        return res(200, receipt(user.snapshot));
      }
      if (m[2] === 'snapshot' && init.method === 'GET') {
        if (!user.snapshot) return res(404, { error: { code: 'not_found' } });
        return res(200, { snapshot: JSON.parse(user.snapshot.body), ...receipt(user.snapshot) });
      }
      if (m[2] === 'shares' && init.method === 'POST') {
        const token = `share-${++this.n}-${'y'.repeat(30)}`;
        const s: Share = { shareId: `s${this.n}`, token, userId, createdAt: this.now, expiresAt: new Date(Date.parse(this.now) + body.expiresInHours * 3600_000).toISOString(), revokedAt: null, scope: body.scope, document: body.document, bytes: JSON.stringify(body.document).length };
        this.shares.push(s);
        return res(201, view(s, true));
      }
      if (m[2] === 'shares' && init.method === 'GET') return res(200, { shares: this.shares.filter((s) => s.userId === userId).map((s) => view(s, false)) });
      if (m[2] === 'shares' && init.method === 'DELETE' && m[3]) {
        const s = this.shares.find((x) => x.shareId === m[3] && x.userId === userId);
        if (!s) return res(404, { error: { code: 'not_found' } });
        s.revokedAt = this.now;
        return res(204, null);
      }
    }
    const pub = path.match(/^\/s\/([^/]+)$/);
    if (pub && init.method === 'GET') {
      const s = this.shares.find((x) => x.token === pub[1]);
      if (!s || s.revokedAt || s.expiresAt <= this.now) return res(404, { error: { code: 'not_found' } });
      return res(200, s.document, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    }
    return res(404, { error: { code: 'not_found' } });
  };
}

const receipt = (s: { body: string; etag: string; uploadedAt: string }) => ({ etag: s.etag, uploadedAt: s.uploadedAt, bytes: s.body.length });
const view = (s: Share, withUrl: boolean) => ({ shareId: s.shareId, ...(withUrl ? { url: `https://health.example.test/s/${s.token}` } : {}), createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, scope: s.scope, bytes: s.bytes });
function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  return { status, headers: { get: (k: string) => h[k as keyof typeof h] ?? null }, text: async () => (body === null ? '' : JSON.stringify(body)) };
}

export class MemorySecrets {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}
