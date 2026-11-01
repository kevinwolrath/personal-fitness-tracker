import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import type { ConfirmDialogProps } from './ConfirmDialog';
import { SHEET_HOST_ID } from './Sheet.web';
import { colors, radius, space, type } from './theme';

/** Web: a centred dialog inside the phone frame (window.confirm can't label its buttons). */
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById(SHEET_HOST_ID)), []);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onCancel]);
  if (!visible) return null;
  const content = (
    <View style={styles.overlay}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={cancelLabel} />
      <View style={styles.dialog} role="alertdialog" aria-modal accessibilityLabel={title} testID="confirm-dialog">
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={type.body}>{message}</Text>
        <View style={styles.actions}>
          <Button title={confirmLabel} onPress={onConfirm} />
          <Button title={cancelLabel} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </View>
  );
  return host ? createPortal(content, host) : content;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', padding: space.xl, zIndex: 20 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, gap: space.md },
  title: { ...type.body, fontSize: 20, fontWeight: '800' },
  actions: { gap: space.sm, marginTop: space.xs },
});
