/** #119 Share preview with a Copy fallback (iOS and Android jest projects). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SharePreviewSheet } from '../SharePreviewSheet';

const TEXT = 'Body Anvil configuration share · format 1 · configuration schema version 1\n\n{ "profile": {} }';
const props = () => ({ title: 'Share with AI', text: TEXT, intro: 'This is exactly what will be shared.', cancelLabel: 'Cancel sharing', onClose: jest.fn(), onResult: jest.fn() });

it('Share hands over exactly the previewed text', async () => {
  const p = props();
  const share = jest.fn(async () => 'shared' as const);
  render(<SharePreviewSheet {...p} share={share} copy={jest.fn()} />);
  expect(screen.getByTestId('share-preview').props.children).toBe(TEXT);
  await act(async () => fireEvent.press(screen.getByTestId('share-confirm')));
  expect(share).toHaveBeenCalledWith(TEXT, 'Share with AI');
  expect(p.onResult).toHaveBeenCalledWith('shared');
});

it('Copy instead copies the same text and reports "copied"; a failing clipboard reports "unavailable"', async () => {
  const p = props();
  const copy = jest.fn(async () => undefined);
  const share = jest.fn();
  render(<SharePreviewSheet {...p} share={share} copy={copy} />);
  await act(async () => fireEvent.press(screen.getByTestId('share-copy')));
  expect(copy).toHaveBeenCalledWith(TEXT);
  expect(share).not.toHaveBeenCalled();
  expect(p.onResult).toHaveBeenLastCalledWith('copied');

  copy.mockRejectedValueOnce(new Error('no clipboard'));
  await act(async () => fireEvent.press(screen.getByTestId('share-copy')));
  expect(p.onResult).toHaveBeenLastCalledWith('unavailable');
});

it('Cancel shares and copies nothing; without copy there is no Copy button', () => {
  const p = props();
  const share = jest.fn();
  render(<SharePreviewSheet {...p} share={share} />);
  expect(screen.queryByTestId('share-copy')).toBeNull();
  fireEvent.press(screen.getByLabelText('Cancel sharing'));
  expect(p.onClose).toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
});
