import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, touch, createThemedStyles } from './theme';

export type ToastState = { key: number; message: string; onUndo?: () => void } | null;

/** Transient confirmation with Undo (contract 02 "Feedback"). */
export function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const styles = useStyles();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <View style={styles.toast} accessibilityLiveRegion="polite" role="status">
      <Text style={styles.text}>{toast.message}</Text>
      {toast.onUndo && (
        <Pressable
          onPress={() => {
            toast.onUndo?.();
            onDone();
          }}
          style={styles.undo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Text style={styles.undoText}>Undo</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: '100%',
    marginBottom: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingLeft: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch,
  },
  text: { flex: 1, color: colors.onCard, fontSize: 15, fontWeight: '600' },
  undo: { minWidth: touch + 16, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.onInkAction, fontSize: 15, fontWeight: '800' },
}));
