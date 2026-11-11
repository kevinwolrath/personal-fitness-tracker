import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, createThemedStyles } from './theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  /** Tall content (e.g. an exercise guide): the panel takes most of the screen and children can flex/scroll. */
  fill?: boolean;
  /**
   * Called once the sheet has finished closing. iOS only (Modal onDismiss): iOS can't present a picker,
   * alert or modal route while a sheet is still animating away. Elsewhere the sheet is gone as soon as
   * `visible` is false, so callers can act straight away.
   */
  onDismiss?: () => void;
};

/**
 * Native sheet. iOS: system page sheet (drag down to dismiss).
 * Android: bottom panel in a transparent modal (back button / scrim to dismiss).
 * See Sheet.web.tsx for the in-frame web version.
 */
/**
 * Sheets can be nested: render a child Sheet inside a parent Sheet's children so it presents on top
 * (iOS can only present a modal from the one currently shown).
 */
export function Sheet({ visible, onClose, children, label, fill, onDismiss }: Props) {
  const styles = useStyles();
  // #142: the app's own insets (root SafeAreaProvider). A SafeAreaView inside an Android Modal doesn't reliably get
  // the navigation-bar inset, so content (the last menu row) ended up under three-button navigation.
  // Read without throwing: a sheet rendered outside the provider (tests) just gets no extra inset.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
        <SafeAreaView style={styles.iosBody} edges={['bottom']} accessibilityLabel={label}>
          <View style={styles.handle} />
          {children}
        </SafeAreaView>
      </Modal>
    );
  }
  return (
    // Edge-to-edge modal window (status and navigation bars translucent), so it matches the app window and the
    // bottom padding below is exactly the system bar's height: three-button navigation gets its full bar, gesture
    // navigation its small handle area, and no bar means no extra blank space.
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior="height">
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.panel, { paddingBottom: space.lg + bottomInset }, fill && styles.panelFill]} accessibilityLabel={label} testID="sheet-panel">
          <View style={styles.handle} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  iosBody: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: space.xl },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    // paddingBottom: space.lg + the navigation-bar inset, set inline (#142).
    maxHeight: '92%', // tall content scrolls inside the sheet rather than pushing it off screen
  },
  panelFill: { height: '92%' },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginVertical: space.sm },
}));
