import { projectExport, type ShareCategory } from '../../export/shareProjection';
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
export const SHARE_BYTES = 64 * 1024;
const shareCats = ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'];

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
const isStamp = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 32);
const textOrNull = (v: unknown, max: number) => v === null || text(v, max);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
const numOrNull = (v: unknown) => v === null || num(v);
const intOrNull = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e6);
const span = (v: unknown) => v === null || (fields(v, ['from', 'to']) && isDate((v as { from: unknown }).from) && isDate((v as { to: unknown }).to));
const list = (v: unknown, max: number, each: (x: any) => boolean) => Array.isArray(v) && v.length <= max && v.every((x) => each(x)); // eslint-disable-line @typescript-eslint/no-explicit-any
const oneOf = (v: unknown, xs: unknown[]) => xs.includes(v);
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(v);
/* eslint-disable @typescript-eslint/no-explicit-any */
const measurement = (m: any) => fields(m, ['id', 'date', 'recordedAt', 'metric', 'value', 'unit', 'source']) && id(m.id) && isDate(m.date) && isStamp(m.recordedAt)
  && /^[a-z0-9_-]{1,40}$/.test(m.metric) && num(m.value) && text(m.unit, 16) && fields(m.source, ['type', 'app', 'edited'])
  && oneOf(m.source.type, ['manual', 'screenshot', 'healthConnect']) && textOrNull(m.source.app, 60) && typeof m.source.edited === 'boolean';
const planned = (p: any) => fields(p, ['activityId', 'label', 'status', 'plannedEnergyKj', 'plannedProteinG']) && id(p.activityId) && text(p.label, 80)
  && oneOf(p.status, ['eaten (ticked)', 'replaced', 'skipped', 'not ticked']) && numOrNull(p.plannedEnergyKj) && numOrNull(p.plannedProteinG);
const logged = (m: any) => fields(m, ['id', 'at', 'name', 'replaces', 'energyKj', 'proteinG', 'carbsG', 'fatG', 'complete', 'source']) && id(m.id) && isStamp(m.at)
  && text(m.name, 120) && textOrNull(m.replaces, 80) && [m.energyKj, m.proteinG, m.carbsG, m.fatG].every(numOrNull) && typeof m.complete === 'boolean' && oneOf(m.source, ['photo-ai', 'manual']);
const foodDay = (d: any) => fields(d, ['date', 'status', 'eaten', 'plannedMeals', 'loggedMeals']) && isDate(d.date) && oneOf(d.status, ['complete', 'partial', 'missing', 'in progress'])
  && fields(d.eaten, ['energyKj', 'proteinG', 'carbsG', 'fatG', 'from']) && [d.eaten.energyKj, d.eaten.proteinG, d.eaten.carbsG, d.eaten.fatG].every(numOrNull)
  && oneOf(d.eaten.from, ['meals', 'day-total', null]) && list(d.plannedMeals, 20, planned) && list(d.loggedMeals, 30, logged);
const session = (x: any) => fields(x, ['date', 'activityId', 'label', 'status', 'variant', 'exercisesDone']) && isDate(x.date) && id(x.activityId) && text(x.label, 80)
  && oneOf(x.status, ['done', 'skipped', 'partial']) && oneOf(x.variant, ['full', 'short']) && list(x.exercisesDone, 60, (e: unknown) => text(e, 80));
const exercise = (e: any) => fields(e, ['id', 'date', 'movement', 'sets', 'reps', 'seconds', 'loadKg', 'rir', 'routine', 'status']) && id(e.id) && isDate(e.date)
  && /^[a-z0-9_]{1,60}$/.test(e.movement) && [e.sets, e.reps, e.seconds].every(intOrNull) && numOrNull(e.loadKg) && numOrNull(e.rir) && textOrNull(e.routine, 40) && oneOf(e.status, ['done', 'skipped']);

/** The Worker's v2 `validateExport` (questspirestudio worker/export.mjs), check for check. */
export function validateSnapshot(v: any) {
  need(fields(v, ['schemaVersion', 'format', 'version', 'appVersion', 'generatedAt', 'timezone', 'asOf', 'readMe', 'units', 'database', 'coverage', 'plan', 'measurements', 'food', 'training', 'counts'])
    && v.schemaVersion === 2 && v.format === 'body-anvil-ai-export' && v.version === 2 && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v.appVersion)
    && isStamp(v.generatedAt) && text(v.timezone, 64) && isDate(v.asOf) && list(v.readMe, 12, (x: unknown) => text(x, 400))
    && fields(v.units, ['mass', 'length', 'energy', 'protein', 'duration', 'distance', 'bodyFat']) && Object.values(v.units).every((x) => text(x, 40)), 'Invalid export envelope');
  const db = v.database;
  need(fields(db, ['startedAt', 'startedAtKind', 'earliestRetainedRecord', 'installSource', 'installSourceNote']) && (db.startedAt === null || isStamp(db.startedAt))
    && oneOf(db.startedAtKind, ['created', 'firstSeen', null]) && (db.earliestRetainedRecord === null || isDate(db.earliestRetainedRecord)) && db.installSource === null
    && text(db.installSourceNote, 200) && fields(v.coverage, ['app', 'healthConnect']) && span(v.coverage.app) && span(v.coverage.healthConnect)
    && (v.plan === null || (fields(v.plan, ['energyTargetKj', 'proteinTargetG', 'weightGoalKg']) && [v.plan.energyTargetKj, v.plan.proteinTargetG, v.plan.weightGoalKg].every(numOrNull))), 'Invalid export coverage or plan');
  need(list(v.measurements, 15_000, measurement), 'Invalid measurements');
  need(list(v.food, 3_660, foodDay), 'Invalid food days');
  need(fields(v.training, ['sessions', 'exercises']) && list(v.training.sessions, 15_000, session) && list(v.training.exercises, 15_000, exercise), 'Invalid training');
  need(isObj(v.counts) && Object.entries(v.counts).every(([k, n]) => /^[A-Za-z]{1,30}$/.test(k) && Number.isInteger(n) && (n as number) >= 0), 'Invalid counts');
  const dates = [...v.measurements, ...v.food, ...v.training.sessions, ...v.training.exercises].map((x: { date: string }) => x.date);
  need(dates.every((d) => d <= v.asOf), 'Records must be on or before asOf');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
      && Array.isArray(input.categories) && input.categories.length > 0 && input.categories.every((c) => typeof c === 'string' && shareCats.includes(c))
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

  /** The Worker's v2 projectExport (the shared TS mirror), with its 64 KB share limit. */
  private project(user: User, scope: Scope) {
    const out = projectExport(JSON.parse(user.snapshot), { range: scope.range, categories: scope.categories as ShareCategory[], format: scope.format });
    if (new TextEncoder().encode(JSON.stringify(out)).byteLength > SHARE_BYTES) throw new ApiError(413, 'Share too large. Choose summary or narrow the scope');
    return out;
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
