/** #34: the time column scales with the system font size and never truncates (iOS and Android renderers). */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ActivityRow } from '../ActivityRow';

const lunch = { id: 'lunch', kind: 'meal', label: 'Fixed lunch', time: '12:00', required: true, tracking: { type: 'check' }, flexible: false } as any;
const row = () => <ActivityRow activity={lunch} log={undefined} showTime editable onPress={() => {}} onMore={() => {}} onSkipToggle={() => {}} />;
const timeStyle = () => StyleSheet.flatten(screen.getByTestId('time-lunch').props.style);


let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
const fontScale = (f: number) => {
  mockFontScale = f;
};

it('keeps the 70 dp column at the default text size', () => {
  fontScale(1);
  render(row());
  expect(timeStyle()).toMatchObject({ minWidth: 70, flexShrink: 0 });
  expect(timeStyle().width).toBeUndefined(); // never a fixed width that could clip "12:00 PM"
});

it('widens the column with a larger system font', () => {
  fontScale(1.3);
  render(row());
  expect(timeStyle().minWidth).toBe(91);
});
