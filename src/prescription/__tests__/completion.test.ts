import example from '../../../fixtures/plans/prescription-example.plan.json';
import { validatePlan } from '../../plan/validate';
import type { DayRecords } from '../../storage/types';
import { advance, setDone, setSkipped, snapshotOf } from '../completion';
import { prescribeDay, requirementKey } from '../prescribe';

const r = validatePlan(example);
if (!r.ok) throw new Error('fixture invalid');
const plan = r.plan;
const empty: DayRecords = { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] };
const p = prescribeDay(plan, '2026-11-02', empty);
const item = (key: string) => p.items.find((i) => i.key === key)!;
const act = (id: string) => plan.activities.find((a) => a.id === id)!;
const ctx = (key: string, current?: any) => ({ planId: plan.id, date: '2026-11-02', now: '2026-11-02T15:04:00+11:00', current, item: item(key) });

it('completing records state + a timestamped event; tapping again undoes with its own event', () => {
  const done = advance(ctx('lunch'), act('lunch'));
  expect(done.log).toMatchObject({ status: 'done', updatedAt: '2026-11-02T15:04:00+11:00', variant: 'full' });
  expect(done.event).toMatchObject({ action: 'complete', activityId: 'lunch', at: '2026-11-02T15:04:00+11:00', purpose: 'nutrition', requirementId: null });
  const undo = advance(ctx('lunch', done.log), act('lunch'));
  expect(undo.log).toBeNull();
  expect(undo.event).toMatchObject({ action: 'undo', activityId: 'lunch' });
  expect(undo.event.id).not.toBe(done.event.id);
});

it('an alternative records which requirement it satisfied', () => {
  const key = requirementKey('hard-conditioning');
  const c = setDone(ctx(key), act('heavy-bag'), true);
  expect(c.log).toMatchObject({ activityId: 'heavy-bag', status: 'done', requirementId: 'hard-conditioning' });
  expect(c.event).toMatchObject({ requirementId: 'hard-conditioning', label: 'Heavy bag rounds' });
});

it('count tracking: progress events until the target completes it', () => {
  const key = requirementKey('hard-conditioning');
  const one = advance(ctx(key), act('vr-boxing'));
  expect(one.log).toMatchObject({ status: 'pending', count: 1 });
  expect(one.event.action).toBe('progress');
  const three = advance(ctx(key, { ...one.log, count: 2 }), act('vr-boxing'));
  expect(three.log).toMatchObject({ status: 'done', count: 3 });
  expect(three.event.action).toBe('complete');
});

it('short version is recorded as the variant', () => {
  expect(setDone(ctx('strength'), act('strength'), true, 'short').log).toMatchObject({ variant: 'short' });
});

it('skipping a requirement skips it as a unit', () => {
  const c = setSkipped(ctx(requirementKey('hard-conditioning')), true);
  expect(c.activityId).toBe('req:hard-conditioning');
  expect(c.event.action).toBe('skip');
});

it('the snapshot captures what was prescribed, independent of later plan edits', () => {
  const snap = snapshotOf(p, plan.id, plan.revision, 'now');
  const s = snap.prescribed as any;
  expect(snap).toMatchObject({ planId: 'prescription-example', date: '2026-11-02', planRevision: 1 });
  expect(s.items.find((i: any) => i.key === 'strength').session.exercises[4]).toEqual({
    movement: 'hammer_curl', label: 'Hammer curl', dose: '2 × 12', substitutedFor: 'Biceps curl', sets: 2, reps: 12, // structured dose (#56)
  });
  expect(s.items.find((i: any) => i.key === 'strength').session.doses).toBe(1);
  expect(s.items.find((i: any) => i.kind === 'requirement').options.map((o: any) => o.id)).toEqual(['vr-boxing', 'heavy-bag', 'battle-ropes']);
});
