/** #56 Today's workout card and sheet on the native renderers (iOS and Android jest projects). */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import seed from '../../../../plans/seed.plan.json';
import { todayWorkout } from '../../../exercises/todayWorkout';
import { validatePlan } from '../../../plan/validate';
import { prescribeDay } from '../../../prescription/prescribe';
import type { ExerciseLog } from '../../../storage/types';
import { TodayWorkoutCard, TodayWorkoutSheet } from '../TodayWorkout';

const r = validatePlan(seed);
if (!r.ok) throw new Error('seed invalid');
const plan = r.plan;
const MON = '2026-11-02';
const items = prescribeDay(plan, MON, { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] }).items;
const calf: ExerciseLog = { id: 'c', movement: 'standing_calf_raise', date: MON, at: 't', sets: 3, reps: 15, seconds: null, intensity: null };
const workout = (freeLogs: ExerciseLog[] = []) => todayWorkout({ plan, date: MON, items, logs: {}, freeLogs, state: null });

it('collapsed card: counts, one tickable exercise, ticking and ⓘ are separate; Show all opens the sheet', () => {
  const onToggle = jest.fn(), onGuide = jest.fn(), onOpen = jest.fn();
  render(<TodayWorkoutCard workout={workout()} promoted={false} editable onToggle={onToggle} onGuide={onGuide} onOpen={onOpen} />);
  expect(screen.getByTestId('today-workout-counts')).toHaveTextContent('0 of 12 done · 12 left');
  expect(screen.getByTestId('today-workout-subtitle')).toHaveTextContent('Strength workout · plan and more');
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Goblet squat, 3 × 10'));
  expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ movement: 'kettlebell_squat', plan: { activityId: 'resistance', key: 'full:0:kettlebell_squat' } }));
  fireEvent.press(screen.getByLabelText('Goblet squat. Show how'));
  expect(onGuide).toHaveBeenCalledTimes(1);
  expect(onToggle).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Show all 12 exercises'));
  expect(onOpen).toHaveBeenCalled();
});

it('promoted card says "Do this next"; everything done says so', () => {
  render(<TodayWorkoutCard workout={workout()} promoted editable={false} onToggle={jest.fn()} onGuide={jest.fn()} onOpen={jest.fn()} />);
  expect(screen.getByText(/Do this next · Today's workout/i)).toBeTruthy();
});

it('sheet: every exercise, to do first and done below; coverage, a different dose and session options are one tap away', () => {
  const h = { onToggle: jest.fn(), onGuide: jest.fn(), onCoverage: jest.fn(), onLogDifferent: jest.fn(), onSessionOptions: jest.fn(), onClose: jest.fn() };
  render(<TodayWorkoutSheet workout={workout([calf])} coverage={null} editable {...h} />);
  expect(within(screen.getByTestId('today-workout-totals')).getByLabelText('12 total')).toBeTruthy();
  expect(within(screen.getByTestId('today-workout-totals')).getByLabelText('1 done')).toBeTruthy();
  expect(within(screen.getByTestId('today-workout-todo')).getAllByRole('checkbox')).toHaveLength(11);
  expect(within(screen.getByTestId('today-workout-done')).getByLabelText('Standing calf raises, 3 × 15')).toBeChecked();
  fireEvent.press(screen.getByLabelText('Muscle coverage. Open the full view'));
  expect(h.onCoverage).toHaveBeenCalled();
  fireEvent.press(screen.getByText('Log with a different dose…'));
  expect(h.onLogDifferent).toHaveBeenCalled();
  fireEvent.press(screen.getByText('Strength workout: full or short, skip and more'));
  expect(h.onSessionOptions).toHaveBeenCalledWith(expect.objectContaining({ key: 'resistance' }));
});
