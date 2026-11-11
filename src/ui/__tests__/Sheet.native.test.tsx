import { render, screen } from '@testing-library/react-native';
import { Modal, Platform, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppMenu } from '../../features/shell/AppMenu';
import { Sheet } from '../Sheet';
import { space } from '../theme';

/** #142: Android sheets pad by the navigation-bar inset from the app's provider and never draw under the bar. */
const metrics = (bottom: number) => ({ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 24, left: 0, right: 0, bottom } });
const android = Platform.OS === 'android' ? describe : describe.skip;

android('Sheet on Android (#142)', () => {
  it.each([
    ['three-button navigation', 48],
    ['gesture navigation', 16],
    ['no navigation bar', 0],
  ])('%s: the panel is padded by exactly the bar inset (no permanent blank space)', (_name, bottom) => {
    render(
      <SafeAreaProvider initialMetrics={metrics(bottom)}>
        <Sheet visible onClose={() => undefined} label="Test sheet">
          <Text>Body</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('sheet-panel')).toHaveStyle({ paddingBottom: space.lg + bottom, maxHeight: '92%' });
  });

  it('the modal window is edge-to-edge, so its insets match the app window', () => {
    const { UNSAFE_getByType } = render(
      <SafeAreaProvider initialMetrics={metrics(48)}>
        <Sheet visible onClose={() => undefined} label="Test sheet">
          <Text>Body</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
  });

  it('outside a provider it still renders, without an extra inset', () => {
    render(
      <Sheet visible onClose={() => undefined} label="Test sheet">
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('sheet-panel')).toHaveStyle({ paddingBottom: space.lg });
  });

  it('the app menu rows scroll inside the sheet, below a fixed header', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, label: `Item ${i}`, detail: 'detail', onSelect: () => undefined }));
    render(
      <SafeAreaProvider initialMetrics={metrics(48)}>
        <AppMenu visible onClose={() => undefined} items={items} />
      </SafeAreaProvider>,
    );
    const scroll = screen.getByTestId('app-menu-scroll');
    expect(scroll).toHaveStyle({ flexShrink: 1 });
    expect(screen.getByTestId('app-menu')).toBeTruthy();
    expect(screen.getByLabelText('Item 13')).toBeTruthy();
  });
});
