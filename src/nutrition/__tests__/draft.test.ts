import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import { prescribeDay } from '../../prescription/prescribe';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { applyReply, blankItem, draftErrors, draftFromLog, draftMatches, finalizeDraft, liveItems, manualEntry, newDraft, readField, restoreDraft } from '../draft';
import { replacementCompletion } from '../replace';

const MON = '2026-11-02';
const start = () => newDraft({ id: 'meal-1', date: MON, planId: 'p', activityId: 'lunch', replacedLabel: 'Fixed lunch', now: 't0' });
const reply = (over: Record<string, unknown> = {}) =>
  `Here you go:\n\`\`\`json\n${JSON.stringify({
    schemaVersion: 1,
    mealName: 'Chicken burrito bowl',
    items: [
      { name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 },
      { name: 'Guacamole', quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null },
    ],
    totals: { energyKj: 3100, proteinG: 38, carbsG: 82, fatG: 24 },
    confidence: 'medium',
    assumptions: ['Sauce not visible'],
    uncertainties: ['Rice type'],
    ...over,
  })}\n\`\`\``;

describe('meal draft (#97): paste → review → save', () => {
  it('a valid reply fills the review and moves to it, keeping unknowns empty', () => {
    const d = applyReply(start(), reply(), 't1');
    expect(d.step).toBe('review');
    expect(d.replyError).toBeNull();
    expect(d.name).toBe('Chicken burrito bowl');
    expect(d.items.map((i) => [i.name, i.quantity, i.unit, i.energyKj, i.proteinG])).toEqual([['Rice', '180', 'g', '980', '5'], ['Guacamole', '', '', '', '']]);
    expect(d.parsed).toMatchObject({ schemaVersion: 1, confidence: 'medium', assumptions: ['Sauce not visible'], uncertainties: ['Rice type'], aiTotals: { energyKj: 3100 } });
  });

  it('an invalid reply keeps the paste and the step, with one message', () => {
    const d = applyReply({ ...start(), step: 'paste' }, '```json\n{ "schemaVersion": 1, "mealN', 't1');
    expect(d.step).toBe('paste');
    expect(d.reply).toContain('mealN');
    expect(d.replyError).toMatch(/cut off/);
    expect(applyReply(start(), reply({ schemaVersion: 3 }), 't1').replyError).toMatch(/newer format/);
  });

  it('saves the meal: totals come from the items, unknown stays null, unedited replies aren’t marked edited', () => {
    const r = finalizeDraft(applyReply(start(), reply(), 't1'), '2026-11-02T12:41:00+11:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log).toMatchObject({
      id: 'meal-1', date: MON, at: '2026-11-02T12:41:00+11:00', planId: 'p', activityId: 'lunch', replacedLabel: 'Fixed lunch',
      name: 'Chicken burrito bowl', source: 'photo-ai', schemaVersion: 1, edited: false, confidence: 'medium',
      aiTotals: { energyKj: 3100, proteinG: 38, carbsG: 82, fatG: 24 },
    });
    expect(r.log.items[1]).toEqual({ name: 'Guacamole', quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null });
  });

  it('edits are kept and marked; invalid fields block Save with field messages', () => {
    const d = applyReply(start(), reply(), 't1');
    const edited = { ...d, items: d.items.map((i, n) => (n === 1 ? { ...i, energyKj: '450', fatG: '9' } : i)) };
    const r = finalizeDraft(edited, 't2');
    expect(r.ok && r.log.edited).toBe(true);
    expect(r.ok && r.log.items[1]).toMatchObject({ energyKj: 450, fatG: 9 });

    const bad = { ...d, name: ' ', items: d.items.map((i, n) => (n === 0 ? { ...i, proteinG: '-3', carbsG: 'abc', energyKj: '20000' } : { ...i, name: '' })) };
    const e = finalizeDraft(bad, 't2');
    expect(e.ok).toBe(false);
    expect(!e.ok && e.errors.map((x) => x.message)).toEqual([
      'Give the meal a name.',
      'Rice: energy is more than one food can have.',
      'Rice: protein must be a number of g, or empty if unknown.',
      'Rice: carbs must be a number of g, or empty if unknown.',
      'Food 2 needs a name.',
    ]);
  });

  it('manual entry: one blank food, no AI fields, source manual', () => {
    const d = manualEntry({ ...start(), name: 'Toast' }, 't1');
    expect(d.step).toBe('review');
    expect(d.items).toHaveLength(1);
    const filled = { ...d, items: [{ ...d.items[0], name: 'Toast', energyKj: '400' }] };
    const r = finalizeDraft(filled, 't2');
    expect(r.ok && r.log).toMatchObject({ source: 'manual', schemaVersion: null, confidence: null, aiTotals: null, edited: false });
    expect(draftErrors({ ...d, items: [] }).map((x) => x.message)).toEqual(['Add at least one food.']);
  });

  it('reads typed fields: empty is unknown, never zero; commas allowed; negatives and text invalid', () => {
    expect(readField('')).toBeNull();
    expect(readField(' 1,200 ')).toBe(1200);
    expect(readField('.5')).toBe(0.5);
    expect(readField('-1')).toBe('invalid');
    expect(readField('12g')).toBe('invalid');
    expect(liveItems([{ ...blankItem(), name: 'X', energyKj: 'abc', proteinG: '3' }])[0]).toMatchObject({ energyKj: null, proteinG: 3 });
  });

  it('editing a saved meal starts at the review with its photos, and keeps when it was recorded', () => {
    const saved = finalizeDraft(applyReply({ ...start(), photos: [{ id: 'ph', uri: 'file:///p.jpg', addedAt: 't', width: null, height: null }] }, reply(), 't1'), 't2');
    if (!saved.ok) throw new Error('not saved');
    const d = draftFromLog(saved.log, 't3');
    expect(d).toMatchObject({ mode: 'edit', step: 'review', id: 'meal-1', photos: saved.log.photos, recordedAt: 't2', at: 't2' });
    const again = finalizeDraft({ ...d, name: 'Renamed' }, 't4');
    expect(again.ok && again.log).toMatchObject({ id: 'meal-1', name: 'Renamed', recordedAt: 't2', updatedAt: 't4', edited: false });
    expect(draftMatches(d, { date: MON, activityId: 'lunch', editId: 'meal-1' })).toBe(true);
    // #179: opening that scheduled meal again resumes this edit of its replacement rather than starting a duplicate.
    expect(draftMatches(d, { date: MON, activityId: 'lunch' })).toBe(true);
    expect(draftMatches(start(), { date: MON, activityId: 'lunch' })).toBe(true);
    expect(draftMatches(start(), { date: MON, activityId: 'dinner' })).toBe(false);
  });

  it('survives a restart: serialises and restores; anything damaged restores as null', () => {
    const d = applyReply({ ...start(), step: 'paste', shared: true }, reply(), 't1');
    expect(restoreDraft(JSON.stringify(d))).toEqual(d);
    expect(restoreDraft(null)).toBeNull();
    expect(restoreDraft('{oops')).toBeNull();
    expect(restoreDraft(JSON.stringify({ ...d, v: 2 }))).toBeNull();
    expect(restoreDraft(JSON.stringify({ ...d, step: 'other' }))).toBeNull();
    expect(restoreDraft(JSON.stringify({ ...d, photos: null }))).toBeNull();
  });
});

describe('replacementCompletion (#97): replace marks the scheduled meal done; removing undoes it', () => {
  const plan = (() => {
    const r = validatePlan(seed);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.plan;
  })();
  const records = (logs: ActivityLog[] = []): DayRecords => ({ activities: Object.fromEntries(logs.map((l) => [l.activityId, l])), dayTypeOverride: null, observations: [], quickLogs: [] });

  it('replacing a scheduled meal completes it, with an event and the day snapshot', () => {
    const c = replacementCompletion(plan, MON, records(), 'lunch', true, 't1');
    expect(c).not.toBeNull();
    expect(c!.log).toMatchObject({ activityId: 'lunch', status: 'done' });
    expect(c!.event).toMatchObject({ action: 'complete', activityId: 'lunch', date: MON });
    const after = prescribeDay(plan, MON, records([c!.log!]));
    expect(after.items.find((i) => i.key === 'lunch')?.state).toBe('done');
  });

  it('a skipped meal becomes done; an already-done meal needs no change', () => {
    const skipped: ActivityLog = { activityId: 'lunch', status: 'skipped', count: 0, labelSnapshot: 'Fixed lunch', updatedAt: 't' };
    expect(replacementCompletion(plan, MON, records([skipped]), 'lunch', true, 't1')?.log?.status).toBe('done');
    const done: ActivityLog = { ...skipped, status: 'done' };
    expect(replacementCompletion(plan, MON, records([done]), 'lunch', true, 't1')).toBeNull();
  });

  it('removing the meal log undoes the completion; nothing to undo when it isn’t done', () => {
    const done: ActivityLog = { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'Fixed lunch', updatedAt: 't' };
    const c = replacementCompletion(plan, MON, records([done]), 'lunch', false, 't2');
    expect(c).toMatchObject({ log: null, event: { action: 'undo' } });
    expect(replacementCompletion(plan, MON, records(), 'lunch', false, 't2')).toBeNull();
  });

  it('only scheduled meals can be replaced', () => {
    expect(replacementCompletion(plan, MON, records(), 'school-run-am', true, 't1')).toBeNull();
    expect(replacementCompletion(plan, MON, records(), 'no-such-meal', true, 't1')).toBeNull();
  });
});

describe('#179: a plain-text AI estimate → one meal → confirm', () => {
  const text = 'Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein';
  it('fills the review with one entry and populated totals; no JSON, carbs or fat needed', () => {
    const d = applyReply(start(), text, 't1');
    expect(d).toMatchObject({ step: 'review', replyError: null, source: 'photo-ai', name: 'Beef curry and dhal' });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ name: 'Beef curry and dhal', energyKj: '2650', proteinG: '45', carbsG: '', fatG: '', quantity: '' });
    expect(d.parsed).toMatchObject({ format: 'text', schemaVersion: null, mealType: 'dinner', issues: [], assumptions: ['AI estimate as written: ~2,650 kJ, 45 g protein.'] });
    const saved = finalizeDraft(d, 't2');
    expect(saved.ok && saved.log).toMatchObject({ id: 'meal-1', name: 'Beef curry and dhal', source: 'photo-ai', schemaVersion: null, edited: false, aiTotals: { energyKj: 2650, proteinG: 45, carbsG: null, fatG: null }, items: [{ energyKj: 2650, proteinG: 45, carbsG: null, fatG: null }] });
  });

  it('unclear values arrive empty with the reason (review, not a refusal); nothing is invented', () => {
    const d = applyReply(start(), 'Dinner: curry, 2,400–2,900 kJ, 45 g protein', 't1');
    expect(d.step).toBe('review');
    expect(d.items[0]).toMatchObject({ energyKj: '', proteinG: '45' });
    expect(d.parsed!.issues.map((i) => i.message).join(' ')).toMatch(/range/);
  });

  it('a different date in the text is said, and the meal stays on the day being logged', () => {
    const d = applyReply(start(), `Dinner on 1 November 2026: ${text.slice(8)}`, 't1');
    expect(d.date).toBe(MON);
    expect(d.parsed!.issues.map((i) => i.message)).toContain('The estimate is for 1 November 2026; this meal is being logged for 2 November 2026.');
  });

  it('junk text gets one actionable message and stays on paste', () => {
    const d = applyReply({ ...start(), step: 'paste' }, 'Thanks! Have a lovely evening.', 't1');
    expect(d.step).toBe('paste');
    expect(d.replyError).toMatch(/No meal estimate found\. Paste the AI’s answer with the meal’s total energy/);
  });

  it('editing a saved text estimate keeps it an AI estimate; changing a value marks it edited', () => {
    const first = finalizeDraft(applyReply(start(), text, 't1'), 't2');
    const d = draftFromLog(first.ok ? first.log : (null as never), 't3');
    expect(d.parsed).toMatchObject({ format: 'text', schemaVersion: null });
    const changed = finalizeDraft({ ...d, items: [{ ...d.items[0], energyKj: '2500' }] }, 't4');
    expect(changed.ok && changed.log).toMatchObject({ id: 'meal-1', source: 'photo-ai', edited: true, items: [{ energyKj: 2500 }] });
  });

  it('pasting into an existing replacement keeps its id: saving replaces, never duplicates', () => {
    const saved = finalizeDraft(applyReply(start(), text, 't1'), 't2');
    const again = applyReply({ ...draftFromLog(saved.ok ? saved.log : (null as never), 't3'), step: 'paste' }, 'Dinner: beef curry and dhal — ~2,400 kJ, 40 g protein', 't4');
    const second = finalizeDraft(again, 't5');
    expect(second.ok && second.log).toMatchObject({ id: 'meal-1', recordedAt: 't2', items: [{ energyKj: 2400, proteinG: 40 }] });
  });
});
