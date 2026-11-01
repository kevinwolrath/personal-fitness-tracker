/**
 * The exercise guide on the native Sheet (iOS pageSheet / Android modal), with react-native-svg.
 * Runs under the ios and android jest projects.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { buildGuide, type ExerciseGuide } from '../../../exercises/guide';
import { ExerciseGuideSheet } from '../ExerciseGuideSheet';

const squat = buildGuide({ movement: 'kettlebell_squat', label: 'Kettlebell squat', sets: 3, reps: 10 });
const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 342, height: 256 } } };

it('steps through the illustrations with previous/next and closes', () => {
  const onClose = jest.fn();
  render(<ExerciseGuideSheet guide={squat} onClose={onClose} />);
  fireEvent(screen.getByTestId('guide-pager'), 'layout', layout);
  expect(screen.getByTestId('guide-title')).toHaveTextContent('Kettlebell squat');
  expect(screen.getByTestId('guide-prescription')).toHaveTextContent('Today: 3 × 10');
  expect(screen.getByTestId('guide-position')).toHaveTextContent('1 / 2');
  expect(screen.getByLabelText(/Kettlebell squat, step 1/)).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Next step'));
  expect(screen.getByTestId('guide-position')).toHaveTextContent('2 / 2');
  expect(screen.getByTestId('guide-caption')).toHaveTextContent(squat.steps[1].caption);
  fireEvent.press(screen.getByLabelText('Next step')); // already on the last step: stays
  expect(screen.getByTestId('guide-position')).toHaveTextContent('2 / 2');
  fireEvent.press(screen.getByLabelText('Previous step'));
  expect(screen.getByTestId('guide-caption')).toHaveTextContent(squat.steps[0].caption);

  fireEvent.press(screen.getByLabelText('Close guide'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('a single-step guide shows the image without step controls', () => {
  const single: ExerciseGuide = { ...squat, steps: squat.steps.slice(0, 1) };
  render(<ExerciseGuideSheet guide={single} onClose={() => {}} />);
  expect(screen.getByLabelText(/Kettlebell squat, step 1/)).toBeTruthy();
  expect(screen.queryByTestId('guide-position')).toBeNull();
  expect(screen.queryByLabelText('Next step')).toBeNull();
  expect(screen.getByTestId('guide-caption')).toHaveTextContent(squat.steps[0].caption);
});

it('an exercise without a definition still shows its name and dose', () => {
  const unknown = buildGuide({ movement: 'turkish_getup', label: 'Turkish get-up', sets: 2, reps: 3 });
  render(<ExerciseGuideSheet guide={unknown} onClose={() => {}} />);
  expect(screen.getByTestId('guide-title')).toHaveTextContent('Turkish get-up');
  expect(screen.getByTestId('guide-no-image')).toHaveTextContent('No guide for this exercise yet.');
  expect(screen.queryByTestId('guide-instructions')).toBeNull();
});

it('renders nothing when closed', () => {
  render(<ExerciseGuideSheet guide={null} onClose={() => {}} />);
  expect(screen.queryByTestId('exercise-guide')).toBeNull();
});
