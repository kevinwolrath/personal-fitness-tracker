import { hcTypes, type HcRead, type HcType } from '../observations/healthConnect';
import type { LocalDate } from '../plan/dates';

/**
 * Web test surface: browsers have no Health Connect. Without a test fixture this reports "unsupported", exactly
 * like an iPhone would, so no made-up data ever appears. E2E tests install a fixture in localStorage
 * (`pft.test.healthConnect`) to drive the real sync, mapping and UI:
 *   { availability, grantOnRequest: HcType[], granted: HcType[], failTypes?: HcType[], data: HcRead }
 * Requests made are counted in `requests`, so tests can prove the app never asks by itself.
 */
export type HcAvailability = 'available' | 'not_installed' | 'update_required' | 'unsupported';

const KEY = 'pft.test.healthConnect';
type Fixture = {
  availability: HcAvailability;
  grantOnRequest: HcType[];
  granted: HcType[];
  failTypes?: HcType[];
  data: HcRead;
  requests?: number;
  reads?: { types: HcType[]; dates: LocalDate[] }[];
  opened?: string[];
};

function fixture(): Fixture | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Fixture) : null;
  } catch {
    return null;
  }
}
function save(f: Fixture) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // storage unavailable
  }
}
function need(): Fixture {
  const f = fixture();
  if (!f || f.availability !== 'available') throw new Error('Health Connect is not available on this device');
  return f;
}

const inDates = (dates: LocalDate[]) => {
  const set = new Set(dates);
  return (iso: string) => set.has(iso.slice(0, 10));
};

export const healthConnect = {
  real: false,

  async availability(): Promise<HcAvailability> {
    return fixture()?.availability ?? 'unsupported';
  },

  async granted(): Promise<HcType[]> {
    return need().granted;
  },

  async request(): Promise<HcType[]> {
    const f = need();
    f.requests = (f.requests ?? 0) + 1;
    f.granted = hcTypes.filter((t) => f.grantOnRequest.includes(t) || f.granted.includes(t));
    save(f);
    return f.granted;
  },

  async read(types: HcType[], dates: LocalDate[]): Promise<{ read: HcRead; failed: HcType[] }> {
    const f = need();
    f.reads = [...(f.reads ?? []), { types, dates }];
    save(f);
    const fail = new Set(f.failTypes ?? []);
    const ok = (t: HcType) => types.includes(t) && !fail.has(t);
    const day = inDates(dates);
    const d = f.data;
    const read: HcRead = {};
    if (ok('steps')) read.steps = (d.steps ?? []).filter((x) => dates.includes(x.date));
    if (ok('active_energy')) read.activeKcal = (d.activeKcal ?? []).filter((x) => dates.includes(x.date));
    if (ok('exercise')) read.exercise = (d.exercise ?? []).filter((x) => day(x.start));
    if (ok('exercise') && d.distances) read.distances = d.distances.filter(x=>day(x.start));
    if (ok('weight')) read.weight = (d.weight ?? []).filter((x) => day(x.time));
    if (ok('body_fat')) read.bodyFat = (d.bodyFat ?? []).filter((x) => day(x.time));
    if (ok('sleep')) read.sleep = d.sleep ?? [];
    return { read, failed: types.filter((t) => fail.has(t)) };
  },

  openSettings(): void {
    const f = fixture();
    if (f) save({ ...f, opened: [...(f.opened ?? []), 'settings'] });
  },

  openInstall(): void {
    const f = fixture();
    if (f) save({ ...f, opened: [...(f.opened ?? []), 'install'] });
  },
};
