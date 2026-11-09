import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { requirementView } from '../conditioning';
import { prescribeDay } from '../prescribe';

/** #90: high-intensity conditioning is one activity with alternative methods, each with its dose. */

const plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const MON = '2026-11-02';
const log = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({ activityId, status: 'pending', count: 0, labelSnapshot: activityId, updatedAt: `${MON}T18:00:00+11:00`, ...over });
const view = (logs: ActivityLog[] = []) => {
  const records: DayRecords = { activities: Object.fromEntries(logs.map((l) => [l.activityId, l])), dayTypeOverride: null, observations: [], quickLogs: [] };
  const item = prescribeDay(plan, MON, records).items.find((i) => i.key === 'req:hard-conditioning')!;
  return { item, v: requirementView(item, records.activities) };
};

it('lists each method with its dose in the plan’s words, nothing chosen yet', () => {
  const { v, item } = view();
  expect(item.state).toBe('pending');
  expect(v.options.map((o) => [o.activity.label, o.dose, o.state])).toEqual([
    ['VR boxing', '3 rounds · Thrill of the Fight · 3-minute rounds', 'idle'],
    ['Heavy bag rounds', '12 min · 3 × 3-minute rounds', 'idle'],
    ['Battle ropes', '10 min · Intervals', 'idle'],
  ]);
  expect(v.chosen).toBeNull();
  expect(v.status).toBe('Pick one · any one counts for today');
});

it('partial rounds mark the method in progress; the others stay available', () => {
  const { v, item } = view([log('vr-boxing', { count: 1 })]);
  expect(item.state).toBe('partial');
  expect(v.chosen?.activity.id).toBe('vr-boxing');
  expect(v.options.map((o) => o.state)).toEqual(['active', 'idle', 'idle']);
  expect(v.status).toBe('VR boxing · 1 of 3 rounds');
});

it('switching method: finishing another one completes conditioning once; the partial rounds stay recorded', () => {
  const { v, item } = view([log('vr-boxing', { count: 1 }), log('heavy-bag', { status: 'done', updatedAt: `${MON}T19:00:00+11:00` })]);
  expect(item.state).toBe('done');
  expect(item.satisfiedBy?.activityId).toBe('heavy-bag');
  expect(v.options.map((o) => o.state)).toEqual(['not-needed', 'done', 'not-needed']);
  expect(v.options[0].progress).toEqual({ count: 1, target: 3, unit: 'rounds' });
  expect(v.status).toBe('Done with Heavy bag rounds · 12 min');
});

it('one of three completes it: all rounds done reads with its dose', () => {
  const { v, item } = view([log('vr-boxing', { status: 'done', count: 3 })]);
  expect(item.state).toBe('done');
  expect(v.status).toBe('Done with VR boxing · 3 rounds');
  expect(v.options.filter((o) => o.state === 'done')).toHaveLength(1);
});

it('two methods marked done still count once: the first one completed it', () => {
  const { item, v } = view([log('battle-ropes', { status: 'done', updatedAt: `${MON}T18:00:00+11:00` }), log('heavy-bag', { status: 'done', updatedAt: `${MON}T19:00:00+11:00` })]);
  expect(item.satisfiedBy?.activityId).toBe('battle-ropes');
  expect(v.options.filter((o) => o.state === 'done').map((o) => o.activity.id)).toEqual(['battle-ropes']);
});

it('skipped reads as skipped', () => {
  const { v } = view([log('req:hard-conditioning', { status: 'skipped' })]);
  expect(v.status).toBe('Skipped');
});
