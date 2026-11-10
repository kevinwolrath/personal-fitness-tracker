/** #122 Muscle Growth section on the native renderers: the shared checklist with Complete and Skip. */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { MuscleGrowthDay } from '../../../exercises/catalogue';
import { exerciseInventory } from '../../../exercises/inventory';
import { MuscleGrowthSection } from '../MuscleGrowthSection';

const day: MuscleGrowthDay = {
  offered: true,
  targets: ['biceps'],
  done: 1,
  skipped: 1,
  remaining: 1,
  rows: [
    { movement: 'hammer_curl', name: 'Hammer curls', planned: { sets: 2, reps: 12 }, status: 'done', log: { id: 'mg', movement: 'hammer_curl', date: '2026-11-02', at: 't', sets: 2, reps: 12, seconds: null, intensity: null, routine: 'muscle_growth', status: 'done', loadKg: 8, rir: 2 }, inRoutine: true, caution: false, custom: false },
    { movement: 'lat_pulldown', name: 'Lat pulldown', planned: { sets: 3, reps: 10 }, status: 'skipped', log: null, inRoutine: true, caution: false, custom: false },
    { movement: 'one_arm_kettlebell_row', name: 'One-arm row', planned: { sets: 3, reps: 10 }, status: 'pending', log: null, inRoutine: true, caution: true, custom: false },
  ],
};

function setup(editable = true) {
  const p = { onComplete: jest.fn(), onSkip: jest.fn(), onGuide: jest.fn(), onDetails: jest.fn(), onEdit: jest.fn() };
  render(<MuscleGrowthSection day={day} inventory={exerciseInventory} coverage={null} hints={{ one_arm_kettlebell_row: 'Try a little more.' }} editable={editable} {...p} />);
  return p;
}

it('shows counts, done/skipped/pending rows, and only offers Skip on rows not done', () => {
  setup();
  expect(screen.getByText('1 of 3 done · 1 skipped · 1 left')).toBeTruthy();
  expect(screen.getByText('skipped')).toBeTruthy();
  expect(screen.queryByLabelText('Skip Hammer curls')).toBeNull();
  expect(screen.getByLabelText('Undo skip: Lat pulldown')).toBeTruthy();
  expect(screen.getByLabelText('Skip One-arm row')).toBeTruthy();
  expect(screen.getByText(/2 × 12 · 8 kg · 2 in reserve/)).toBeTruthy();
  expect(screen.getByText(/One-arm row: Try a little more\./)).toBeTruthy();
});

it('the circle completes, Skip skips, the row opens its guide; read-only days change nothing', () => {
  const p = setup();
  fireEvent.press(screen.getByLabelText('One-arm row, 3 × 10'));
  expect(p.onComplete).toHaveBeenCalledWith(day.rows[2]);
  fireEvent.press(screen.getByLabelText('Skip One-arm row'));
  expect(p.onSkip).toHaveBeenCalledWith(day.rows[2]);
  fireEvent.press(screen.getByLabelText('Lat pulldown, 3 × 10. Show how'));
  expect(p.onGuide).toHaveBeenCalledWith(expect.objectContaining({ movement: 'lat_pulldown' }));
  fireEvent.press(screen.getByLabelText('Edit Muscle Growth routine'));
  expect(p.onEdit).toHaveBeenCalled();
});
