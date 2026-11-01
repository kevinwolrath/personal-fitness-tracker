import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from './theme';

type Props = { visible: boolean; onClose: () => void; children: ReactNode; label: string };

/** Web: bottom sheet rendered inside the phone frame (a portal would escape it). */
export function Sheet({ visible, onClose, children, label }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.panel} role="dialog" aria-modal accessibilityLabel={label}>
        <View style={styles.handle} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 10 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginVertical: space.sm },
});
