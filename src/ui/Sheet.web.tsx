import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from './theme';

/** `onDismiss` is iOS-only (see Sheet.tsx); a web sheet is gone as soon as `visible` is false. */
type Props = { visible: boolean; onClose: () => void; children: ReactNode; label: string; fill?: boolean; onDismiss?: () => void };

/** id of the host layer PhoneFrame.web renders over the phone column. */
export const SHEET_HOST_ID = 'sheet-host';

/**
 * Web: bottom sheet inside the phone frame. Rendered through a portal into the frame's sheet host,
 * so a sheet opened from inside another sheet (an exercise guide from the session sheet) still covers
 * the whole frame and stacks on top.
 */
export function Sheet({ visible, onClose, children, label, fill }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById(SHEET_HOST_ID)), []);
  if (!visible) return null;
  const content = (
    <View style={styles.overlay}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.panel, fill && styles.fill]} role="dialog" aria-modal accessibilityLabel={label}>
        <View style={styles.handle} />
        {children}
      </View>
    </View>
  );
  return host ? createPortal(content, host) : content;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 10, pointerEvents: 'auto' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  fill: { height: '92%' },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginVertical: space.sm },
});
