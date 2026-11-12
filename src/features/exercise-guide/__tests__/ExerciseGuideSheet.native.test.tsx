/**
 * The exercise guide on the native Sheet (iOS pageSheet / Android modal), with react-native-svg.
 * Runs under the ios and android jest projects.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { buildGuide, type ExerciseGuide } from '../../../exercises/guide';
import { ExerciseGuideSheet } from '../ExerciseGuideSheet';
import { exerciseArtwork } from '../../../exercises/heroIllustrations';
import { characterFor } from '../../muscles/artwork';

const squat = buildGuide({ movement: 'kettlebell_squat', label: 'Kettlebell squat', sets: 3, reps: 10 });
const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 342, height: 256 } } };

it.each(['male', 'female', 'other', undefined, 'unknown'])('#98 always shows matching activation for %s with no toggle or inactive leg highlight', gender => {
  const guide = buildGuide({ movement: 'knuckle_push_up', label: 'Push-up' });
  render(<ExerciseGuideSheet guide={guide} gender={gender} onClose={jest.fn()} />);
  const hero = characterFor(gender);
  expect(screen.getByLabelText(`${hero}, front activated muscle map. Muscle names are listed in text.`)).toBeTruthy();
  expect(screen.getByLabelText(`${hero}, back activated muscle map. Muscle names are listed in text.`)).toBeTruthy();
  expect(screen.queryByText(/Show activated|Hide activated/)).toBeNull();
  expect(screen.getByTestId('muscle-front-chest').props.fillOpacity).toBe(0.55);
  expect(screen.getByTestId('muscle-front-core').props.strokeDasharray).toEqual(['12', '8']);
  expect(screen.getByTestId('muscle-front-quadriceps').props.fillOpacity).toBe(0);
  expect(screen.getByTestId('guide-image-1', { includeHiddenElements: true }).props.source).toEqual(exerciseArtwork(guide.steps[0].image, gender).source);
});

it('#98 shows custom activation without inventing a movement pose, and never substitutes a mismatched pose', () => {
  const guide = buildGuide({ movement: 'custom_hold', label: 'Custom hold' }, { customExercises: [{ movement: 'custom_hold', name: 'Custom hold', kind: 'strength', equipment: [], primary: ['core'], secondary: [] }] });
  render(<ExerciseGuideSheet guide={guide} gender="female" onClose={jest.fn()} />);
  expect(screen.getByTestId('guide-no-image')).toBeTruthy();
  expect(screen.getByTestId('guide-primary-muscles')).toHaveTextContent('Primary: Core/abdominals');
  expect(screen.getByLabelText('female, front activated muscle map. Muscle names are listed in text.')).toBeTruthy();
  expect(screen.queryByTestId('guide-image-1')).toBeNull();
});

it.each(['male', 'female', 'other'])('#151 pages all three manifest-resolved curl phases for %s', gender => {
  const curl = buildGuide({ movement: 'supinated_cross_body_dumbbell_curl', label: 'Supinated cross-body dumbbell curl', sets: 3, reps: 10, loadKg: 7 });
  render(<ExerciseGuideSheet guide={curl} gender={gender} onClose={() => {}} />);
  fireEvent(screen.getByTestId('guide-pager'), 'layout', layout);
  for (let step = 1; step <= 3; step++) {
    expect(screen.getByTestId('guide-position')).toHaveTextContent(`${step} / 3`);
    expect(screen.getByTestId(`guide-image-${step}`, { includeHiddenElements: true }).props.source).toEqual(exerciseArtwork(curl.steps[step - 1].image, gender).source);
    if (step < 3) fireEvent.press(screen.getByLabelText('Next step'));
  }
});

it('updates mounted guide artwork when the profile changes, including clearing gender', () => {
  const { rerender } = render(<ExerciseGuideSheet guide={squat} gender="male" onClose={() => {}} />);
  for (const gender of ['male', 'female', 'other', undefined, 'male']) {
    rerender(<ExerciseGuideSheet guide={squat} gender={gender} onClose={() => {}} />);
    for (const [i, step] of squat.steps.entries()) {
      expect(screen.getByTestId(`guide-image-${i + 1}`, { includeHiddenElements: true }).props.source).toEqual(exerciseArtwork(step.image, gender).source);
    }
    expect(screen.queryByTestId('guide-artwork-note')).toBeNull();
  }
});

it('steps through the illustrations with previous/next and closes', () => {
  const onClose = jest.fn();
  render(<ExerciseGuideSheet guide={squat} onClose={onClose} />);
  fireEvent(screen.getByTestId('guide-pager'), 'layout', layout);
  expect(screen.getByTestId('guide-title')).toHaveTextContent('Kettlebell squat');
  expect(screen.getByTestId('guide-prescription')).toHaveTextContent('Today: 3 × 10');
  expect(screen.getByTestId('guide-position')).toHaveTextContent('1 / 2');
  expect(screen.getByLabelText(/Kettlebell squat, step 1/)).toBeTruthy();
  const image = screen.getByTestId('guide-image-1', { includeHiddenElements: true });
  expect(image.props.source).toBeTruthy();
  expect(image.props.resizeMode).toBe('contain');
  expect(StyleSheet.flatten(image.props.style).height).toBe(342 * 3 / 4);

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

it('a native swipe updates the caption and step indicators to match the displayed image', () => {
  render(<ExerciseGuideSheet guide={squat} onClose={() => {}} />);
  fireEvent(screen.getByTestId('guide-pager'), 'layout', layout);
  fireEvent(screen.getByTestId('guide-step-scroll'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 342, y: 0 } } });
  expect(screen.getByTestId('guide-position')).toHaveTextContent('2 / 2');
  expect(screen.getByTestId('guide-caption')).toHaveTextContent(squat.steps[1].caption);
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

it.each(['male', 'female', 'other'])('#153 shows and pages the kettlebell shrug for %s', gender => {
  const guide = buildGuide({ movement: 'kettlebell_shrug', label: 'Kettlebell shrug', sets: 2, reps: 12 }, {
    customExercises: [{ movement: 'kettlebell_shrug', name: 'Kettlebell shrug', kind: 'strength', equipment: ['kettlebell'], primary: ['upper_back'], secondary: ['forearms'] }],
  });
  render(<ExerciseGuideSheet guide={guide} gender={gender} onClose={() => {}} />);
  fireEvent(screen.getByTestId('guide-pager'), 'layout', layout);
  expect(screen.queryByTestId('guide-no-image')).toBeNull();
  expect(screen.getByTestId('guide-prescription')).toHaveTextContent('Today: 2 \u00d7 12');
  for (let step = 1; step <= 2; step++) {
    expect(screen.getByTestId('guide-position')).toHaveTextContent(`${step} / 2`);
    expect(screen.getByTestId(`guide-image-${step}`, { includeHiddenElements: true }).props.source).toEqual(exerciseArtwork(guide.steps[step - 1].image, gender).source);
    if (step === 1) fireEvent.press(screen.getByLabelText('Next step'));
  }
  expect(screen.getByText(/Do not roll your shoulders/)).toBeTruthy();
});
