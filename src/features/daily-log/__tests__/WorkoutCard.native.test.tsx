/** The #28 workout card on the native renderers (iOS and Android jest projects). */
import { fireEvent, render, screen } from '@testing-library/react-native';
import seed from '../../../../plans/seed.plan.json';
import { validatePlan } from '../../../plan/validate';
import { sessionProgress } from '../../../prescription/exercises';
import { prescribeDay } from '../../../prescription/prescribe';
import { WorkoutCard } from '../WorkoutCard';

const r = validatePlan(seed);
if (!r.ok) throw new Error('seed invalid');
const item = prescribeDay(r.plan, '2026-11-02', { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] }).items.find((i) => i.key === 'resistance')!;
const progress = sessionProgress(item.session!, undefined);
const handlers = () => ({ onToggleExpanded: jest.fn(), onTick: jest.fn(), onChooseVariant: jest.fn(), onOpenExercise: jest.fn(), onDetails: jest.fn() });

it('collapsed: one tickable next exercise; ticking and ⓘ are separate actions', () => {
  const h = handlers();
  render(<WorkoutCard item={item} progress={progress} expanded={false} {...h} />);
  expect(screen.getByTestId('workout-summary')).toHaveTextContent('35 min · 0 of 5 exercises');
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Kettlebell squat, 3 × 10'));
  expect(h.onTick).toHaveBeenCalledWith(expect.objectContaining({ key: 'full:0:kettlebell_squat' }));
  fireEvent.press(screen.getByLabelText('Kettlebell squat, 3 × 10. Show how'));
  expect(h.onOpenExercise).toHaveBeenCalledTimes(1);
  expect(h.onTick).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/^Done/)).toBeNull();
});

it('expanded: Full/Short switch and every exercise', () => {
  const h = handlers();
  render(<WorkoutCard item={item} progress={progress} expanded {...h} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  fireEvent.press(screen.getByLabelText('Short · 10 min'));
  expect(h.onChooseVariant).toHaveBeenCalledWith('short');
});

it('complete: says so with the count, and offers what is next', () => {
  const h = handlers();
  const done = sessionProgress(item.session!, { activityId: 'resistance', status: 'done', count: 0, labelSnapshot: 'x', updatedAt: 't', variant: 'full' });
  const onDismiss = jest.fn();
  render(<WorkoutCard item={item} progress={done} expanded={false} completed onDismissCompleted={onDismiss} {...h} />);
  expect(screen.getByTestId('next-action-title')).toHaveTextContent('Strength workout complete');
  expect(screen.getByTestId('workout-summary')).toHaveTextContent('5 of 5 exercises ✓');
  fireEvent.press(screen.getByLabelText("Show what's next"));
  expect(onDismiss).toHaveBeenCalled();
});
