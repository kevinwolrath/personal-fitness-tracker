import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { secrets } from '../../platform/secrets';
import { ThemeProvider, THEME_PREFERENCE } from '../ThemeProvider';
import { createThemedStyles, useTheme } from '../theme';
jest.mock('../../platform/secrets', () => ({ secrets: { get: jest.fn(), set: jest.fn() } }));
const get = secrets.get as jest.Mock;
const set = secrets.set as jest.Mock;
const useStyles = createThemedStyles(({ colors }) => ({ page: { backgroundColor: colors.bg } }));
function Probe() {
  const theme = useTheme(); const styles = useStyles();
  return <View testID="page" style={styles.page}><Text testID="choice">{theme.id} {theme.ready ? 'ready' : 'loading'} {theme.saveError ? 'save-error' : ''}</Text>
    <Pressable accessibilityLabel="Choose Classic" onPress={() => theme.setTheme('classic')}><Text>Classic</Text></Pressable>
    <Pressable accessibilityLabel="Choose Hero" onPress={() => theme.setTheme('hero-forge')}><Text>Hero</Text></Pressable>
  </View>;
}
beforeEach(() => { get.mockReset().mockResolvedValue(null); set.mockReset().mockResolvedValue(undefined); });
it('defaults to Hero Forge, switches live and restores Classic on a restart', async () => {
  const first = render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('hero-forge ready'));
  fireEvent.press(screen.getByLabelText('Choose Classic'));
  await waitFor(() => expect(set).toHaveBeenLastCalledWith(THEME_PREFERENCE, 'classic'));
  expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: '#F5F2EB' });
  first.unmount(); get.mockResolvedValue('classic');
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('classic ready'));
  expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: '#F5F2EB' });
});
it('unknown persisted themes safely fall back to Hero Forge', async () => {
  get.mockResolvedValue('removed-theme'); render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('hero-forge ready'));
  expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: '#101519' });
});
it('an old pending read cannot overwrite a new user selection; writes stay ordered', async () => {
  let finish!: (value: string) => void; get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<ThemeProvider><Probe /></ThemeProvider>);
  fireEvent.press(screen.getByLabelText('Choose Classic')); fireEvent.press(screen.getByLabelText('Choose Hero'));
  finish('classic');
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('hero-forge ready'));
  await waitFor(() => expect(set.mock.calls.map(c => c[1])).toEqual(['classic', 'hero-forge']));
});
it('keeps the selected appearance and exposes a retryable save failure', async () => {
  set.mockRejectedValue(new Error('storage unavailable')); render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('hero-forge ready'));
  fireEvent.press(screen.getByLabelText('Choose Classic'));
  await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('classic ready save-error'));
  expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: '#F5F2EB' });
});
