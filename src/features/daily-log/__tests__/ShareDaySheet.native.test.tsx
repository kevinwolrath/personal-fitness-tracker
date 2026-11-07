/** #76 Share this day preview on the native renderers (iOS and Android jest projects). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ShareDaySheet } from '../ShareDaySheet';

const TEXT = 'Review my daily fitness activity for weight loss.\n\nBody Anvil — Daily activity — Mon 2 Nov 2026\nWeight: 97.8 kg';

it('shows the exact text; Share hands over that same text, then reports the result', async () => {
  const share = jest.fn(async () => 'shared' as const);
  const onResult = jest.fn();
  render(<ShareDaySheet text={TEXT} onClose={jest.fn()} onResult={onResult} share={share} />);
  expect(screen.getByTestId('share-preview').props.children).toBe(TEXT); // exact, line breaks included
  expect(screen.getByText(/It includes your weight/)).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('share-confirm')));
  expect(share).toHaveBeenCalledWith(TEXT, 'Share this day');
  expect(onResult).toHaveBeenCalledWith('shared');
});

it('Cancel closes without sharing; without a weight there is no weight warning', () => {
  const share = jest.fn(), onClose = jest.fn();
  render(<ShareDaySheet text={'Review…\n\nBody Anvil — Daily activity — Mon 2 Nov 2026\nNo activity logged.'} onClose={onClose} onResult={jest.fn()} share={share} />);
  expect(screen.queryByText(/It includes your weight/)).toBeNull();
  fireEvent.press(screen.getByLabelText('Cancel sharing'));
  expect(onClose).toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
});
