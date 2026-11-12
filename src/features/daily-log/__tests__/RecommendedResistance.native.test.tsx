import { render, screen, fireEvent } from '@testing-library/react-native';
import { RecommendedResistance } from '../RecommendedResistance';
import type { ResistanceRecommendation } from '../../../exercises/recommendedResistance';
import type { WorkoutRow } from '../../../exercises/todayWorkout';

const row: WorkoutRow = { movement: 'plank', name: 'Plank', dose: { sets: 1, seconds: 20 }, doseLabel: '1 × 20 s', plan: null, prescribed: null, muscles: ['Core'], status: null, caution: false, done: false, doneBy: null, freeLogIds: [] };
const recommendation: ResistanceRecommendation = { kind: 'ready', muscle: 'core', label: 'Core', reason: '1 recorded effective set across 1 training day.', score: 1, volume: 1, planned: 0, trainingDays: 1, rows: [row] };
it('A shows the reason, expands into illustrated logging/guide controls, and creates no task checkbox', () => {
  const onLog = jest.fn(), onGuide = jest.fn();
  render(<RecommendedResistance recommendation={recommendation} loading={false} onLog={onLog} onGuide={onGuide} />);
  expect(screen.getByText(/recorded effective set/)).toBeTruthy();
  expect(screen.queryByTestId('recommended-exercises')).toBeNull();
  fireEvent.press(screen.getByLabelText('Recommended Resistance Training. Core. Optional. 1 recorded effective set across 1 training day.'));
  fireEvent.press(screen.getByLabelText('Log optional Plank'));
  expect(onLog).toHaveBeenCalledWith(row);
  fireEvent.press(screen.getByLabelText('Plank. Show how'));
  expect(onGuide).toHaveBeenCalledWith(row);
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
});
it('an empty/loading state names no muscle and offers no logging control', () => {
  render(<RecommendedResistance recommendation={{ kind: 'empty', reason: 'More history needed' }} loading={false} onLog={jest.fn()} onGuide={jest.fn()} />);
  expect(screen.getByText('More history needed')).toBeTruthy();
  expect(screen.queryByTestId('recommended-muscle')).toBeNull();
});
