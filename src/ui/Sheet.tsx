import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space } from './theme';

type Props = { visible: boolean; onClose: () => void; children: ReactNode; label: string };

/**
 * Native sheet. iOS: system page sheet (drag down to dismiss).
 * Android: bottom panel in a transparent modal (back button / scrim to dismiss).
 * See Sheet.web.tsx for the in-frame web version.
 */
export function Sheet({ visible, onClose, children, label }: Props) {
  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={styles.iosBody} edges={['bottom']} accessibilityLabel={label}>
          <View style={styles.handle} />
          {children}
        </SafeAreaView>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior="height">
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <SafeAreaView style={styles.panel} edges={['bottom']} accessibilityLabel={label}>
          <View style={styles.handle} />
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  iosBody: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: space.xl },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginVertical: space.sm },
});
