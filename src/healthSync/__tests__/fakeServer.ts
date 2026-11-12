/**
 * An in-memory stand-in for the deployed Body Anvil Worker (#163), following its contract and its checks exactly:
 * questspirestudio worker/index.mjs and worker/snapshot.mjs (docs/body-anvil/SYNC_API.md). Strict on every key,
 * pattern and status, like the real one, so a client that drifts from the contract fails here too. Records every
 * request (with headers) for leak checks.
 */
type Req = { method: string; url: string; headers: Record<string, string>; body?: string };
type User = { retryKey: string; ownerToken: string; snapshot: string; checksum: string; revision: string; updatedAt: string };
type Share = { id: string; token: string; uuid: string; revision: string; scope: Scope; expiresAt: number; revoked: boolean };
type Scope = { range: 7 | 30 | 90 | 'all'; categories: string[]; format: 'records' | 'summary'; expiresIn: number };

const prefix = '/api/body-anvil/v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const idPattern = /^[0-9a-f]{32}$/;
const metrics: Record<string, string[]> = {
  measurements: ['weight', 'waist', 'bodyFat'],
  activity: ['steps', 'activeEnergy', 'activeMinutes', 'distance'],
  sleep: ['duration'],
  training: ['sessions', 'duration', 'sets', 'reps', 'volume'],
  nutrition: ['energy', 'protein', 'carbs', 'fat', 'fiber', 'water', 'meals'],
  plan: ['energyTarget', 'proteinTarget', 'carbsTarget', 'fatTarget', 'stepTarget', 'weightTarget', 'sessionsPlanned'],
};
const sources = ['manual', 'screenshot', 'healthConnect', 'integration', 'app', 'plan'];

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const need = (ok: unknown, message: string) => {
  if (!ok) throw new ApiError(400, message);
};
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The Worker's `fields`: every required key present and no other keys. */
const fields = (v: unknown, required: string[], optional: string[] = []) =>
  isObj(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function validateSnapshot(value: unknown) {
  need(fields(value, ['schemaVersion', 'appVersion', 'coverage', 'records']), 'Invalid snapshot envelope');
  const v = value as { schemaVersion: unknown; appVersion: unknown; coverage: unknown; records: unknown };
  need(v.schemaVersion === 1 && typeof v.appVersion === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v.appVersion)
    && fields(v.coverage, ['from', 'to']) && isDate((v.coverage as { to: unknown }).to)
    && Array.isArray(v.records) && v.records.length <= 15_000, 'Invalid snapshot envelope');
  const to = (v.coverage as { to: string }).to;
  let first: string | null = null;
  for (const r of v.records as unknown[]) {
    need(fields(r, ['date', 'category', 'metric', 'value', 'source']), 'Invalid record fields');
    const { date, category, metric, value: amount, source } = r as Record<string, unknown>;
    need(isDate(date) && (date as string) <= to && typeof category === 'string' && Object.hasOwn(metrics, category)
      && typeof metric === 'string' && metrics[category].includes(metric) && typeof amount === 'number' && Number.isFinite(amount)
      && amount >= 0 && amount <= 1e9 && (metric !== 'bodyFat' || amount <= 100) && sources.includes(source as string),
    'Invalid record date, metric, value or source');
    if (first === null || (date as string) < first) first = date as string;
  }
  need((v.coverage as { from: unknown }).from === first, 'Coverage start must match the earliest record or be null');
}

const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { get: (n: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] ?? null },
  text: async () => JSON.stringify(body),
});

export class FakeHealthServer {
  requests: Req[] = [];
  users = new Map<string, User>();
  shares: Share[] = [];
  offline = false;
  failNext: number | null = null;
  /** Drop the response of the next enroll after storing it (an interrupted request). */
  dropNextEnrollResponse = false;
  now = Date.parse('2026-11-12T00:00:00.000Z');
  /** The shared enrollment key the fake accepts (#136): 64 hex like the real one. A placeholder, never a real secret. */
  enrollmentKey = 'e'.repeat(64);
  private n = 0;
  private hex = (len: number) => (++this.n).toString(16).padStart(len, '0');

  fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    this.requests.push({ method: init.method, url, headers: init.headers, body: init.body });
    if (this.offline) throw new TypeError('Network request failed');
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return res(status, { error: 'Try again later' }, { 'Retry-After': '60' });
    }
    try {
      return this.route(new URL(url), init);
    } catch (e) {
      if (e instanceof ApiError) return res(e.status, { error: e.message }, e.status === 429 ? { 'Retry-After': '60' } : {});
      throw e;
    }
  };

  private readJson(init: { headers: Record<string, string>; body?: string }) {
    const type = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    if (type?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Expected application/json');
    try {
      return JSON.parse(init.body ?? '') as unknown;
    } catch {
      throw new ApiError(400, 'Invalid JSON body');
    }
  }

  private header(init: { headers: Record<string, string> }, name: string) {
    return Object.entries(init.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  }

  private store(snapshot: unknown) {
    validateSnapshot(snapshot);
    const s = JSON.stringify(snapshot);
    return { snapshot: s, checksum: this.hex(64) };
  }

  private route(u: URL, init: { method: string; headers: Record<string, string>; body?: string }) {
    const path = u.pathname;
    if (!path.startsWith(`${prefix}/`)) throw new ApiError(404, 'API route not found');
    const suffix = path.slice(prefix.length);
    if (suffix === '/enroll') {
      if (init.method !== 'POST') return res(405, { error: 'Method not allowed' });
      const key = this.header(init, 'X-Enrollment-Key');
      if (key === null || !tokenPattern.test(key) || key !== this.enrollmentKey) throw new ApiError(401, 'Enrollment key required or invalid');
      const input = this.readJson(init) as Record<string, unknown>;
      need(fields(input, ['uuid', 'retryKey', 'snapshot']) && typeof input.uuid === 'string' && uuidPattern.test(input.uuid)
        && typeof input.retryKey === 'string' && tokenPattern.test(input.retryKey), 'Invalid enrollment envelope');
      const uuid = input.uuid as string;
      const retryKey = input.retryKey as string;
      const existing = this.users.get(uuid);
      if (existing) {
        if (existing.retryKey !== retryKey) throw new ApiError(409, 'UUID already enrolled');
        const { ownerToken, updatedAt, revision, checksum } = existing;
        return res(200, { ownerToken, updatedAt, revision, checksum });
      }
      const stored = this.store(input.snapshot);
      const user: User = { retryKey, ownerToken: this.hex(64), ...stored, revision: this.hex(32), updatedAt: new Date(this.now).toISOString() };
      this.users.set(uuid, user);
      if (this.dropNextEnrollResponse) {
        this.dropNextEnrollResponse = false;
        throw new TypeError('Network request failed');
      }
      return res(201, { ownerToken: user.ownerToken, updatedAt: user.updatedAt, revision: user.revision, checksum: user.checksum });
    }
    const shared = /^\/shared\/([^/]+)$/.exec(suffix);
    if (shared) {
      const s = this.shares.find((x) => x.token === shared[1] && !x.revoked && x.expiresAt > this.now);
      const owner = s && this.users.get(s.uuid);
      if (!s || !owner || owner.revision !== s.revision) throw new ApiError(404, 'Share unavailable');
      return res(200, this.project(owner, s.scope));
    }
    const m = /^\/users\/([^/]+)\/(snapshot|shares(?:\/preview|\/[^/]+)?|credentials\/rotate)$/.exec(suffix);
    if (!m) throw new ApiError(404, 'API route not found');
    const [, uuid, resource] = m;
    need(uuidPattern.test(uuid), 'Expected lowercase UUIDv4');
    const methods = resource === 'snapshot' ? ['GET', 'PUT'] : resource.startsWith('shares/') && resource !== 'shares/preview' ? ['DELETE'] : ['POST'];
    if (!methods.includes(init.method)) return res(405, { error: 'Method not allowed' });
    const bearer = this.header(init, 'Authorization')?.match(/^Bearer ([0-9a-f]{64})$/i);
    if (!bearer) throw new ApiError(401, 'Owner bearer credential required');
    const user = this.users.get(uuid);
    if (!user || user.ownerToken !== bearer[1]) throw new ApiError(403, 'Owner credential rejected');
    if (resource === 'snapshot') {
      if (init.method === 'GET') return res(200, JSON.parse(user.snapshot), { ETag: `"${user.checksum}"`, 'X-Body-Anvil-Revision': user.revision, 'X-Body-Anvil-Updated-At': user.updatedAt });
      Object.assign(user, this.store(this.readJson(init)), { revision: this.hex(32), updatedAt: new Date(this.now).toISOString(), retryKey: '' });
      return res(200, { updatedAt: user.updatedAt, revision: user.revision, checksum: user.checksum });
    }
    if (init.method === 'DELETE') {
      const id = resource.slice('shares/'.length);
      need(idPattern.test(id), 'Invalid share ID');
      const s = this.shares.find((x) => x.id === id && x.uuid === uuid);
      if (!s) throw new ApiError(404, 'Share unavailable');
      s.revoked = true;
      return res(200, { revoked: true });
    }
    const input = this.readJson(init) as Record<string, unknown>;
    need(fields(input, ['range', 'categories', 'format', 'expiresIn'], ['revision']) && [7, 30, 90, 'all'].includes(input.range as number)
      && Array.isArray(input.categories) && input.categories.length > 0 && input.categories.every((c) => typeof c === 'string' && Object.hasOwn(metrics, c))
      && ['records', 'summary'].includes(input.format as string) && Number.isInteger(input.expiresIn) && (input.expiresIn as number) >= 60 && (input.expiresIn as number) <= 86400,
    'Invalid share scope');
    const scope = { range: input.range, categories: input.categories, format: input.format, expiresIn: input.expiresIn } as Scope;
    if (resource === 'shares/preview') return res(200, { revision: user.revision, data: this.project(user, scope) });
    if (resource !== 'shares') throw new ApiError(404, 'API route not found');
    need(typeof input.revision === 'string' && idPattern.test(input.revision), 'Preview revision required');
    if (input.revision !== user.revision) throw new ApiError(409, 'Snapshot changed. Preview the share again');
    const share: Share = { id: this.hex(32), token: this.hex(64), uuid, revision: user.revision, scope, expiresAt: this.now + scope.expiresIn * 1000, revoked: false };
    this.shares.push(share);
    return res(201, { id: share.id, url: `${u.origin}${prefix}/shared/${share.token}`, expiresAt: new Date(share.expiresAt).toISOString() });
  }

  /** The Worker's projectShare, "records" format (summary not needed by the app). */
  private project(user: User, scope: Scope) {
    const snap = JSON.parse(user.snapshot) as { schemaVersion: number; appVersion: string; coverage: { to: string }; records: { date: string; category: string }[] };
    const to = snap.coverage.to;
    const from = scope.range === 'all' ? null : new Date(Date.parse(to) - (scope.range - 1) * 86_400_000).toISOString().slice(0, 10);
    const data = snap.records.filter((r) => scope.categories.includes(r.category) && (from === null || r.date >= from));
    const dates = data.map((r) => r.date).sort();
    return { schemaVersion: snap.schemaVersion, provenance: { app: 'Body Anvil', appVersion: snap.appVersion }, format: scope.format, requested: { range: scope.range, categories: scope.categories, from, to }, coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }, data };
  }
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
