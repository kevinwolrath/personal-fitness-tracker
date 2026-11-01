import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '../../ui/Sheet';
import { colors, space, touch, type } from '../../ui/theme';
import { ModalHeader } from '../../ui/ModalHeader';

export type AppMenuItem = { key: string; label: string; detail: string; onSelect: () => void };

type Props = { visible: boolean; onClose: () => void; items: AppMenuItem[] };

/**
 * App-level operations (import, configuration, export), one level down from the Daily Log (#15).
 * The menu closes before an item runs. On iOS the item runs once the sheet has dismissed, because
 * iOS can't present the photo picker, an alert or a modal route over a closing sheet. Elsewhere it
 * runs inside the tap, which web browsers require before they'll open a file picker.
 */
export function AppMenu({ visible, onClose, items }: Props) {
  const pending = useRef<(() => void) | null>(null);
  const select = (item: AppMenuItem) => {
    onClose();
    if (Platform.OS === 'ios') pending.current = item.onSelect;
    else item.onSelect();
  };
  const onDismiss = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  return (
    <Sheet visible={visible} onClose={onClose} label="Menu" onDismiss={onDismiss}>
      <ModalHeader title="Menu" dismiss={{ label: 'Close', onPress: onClose }} />
      <View style={styles.list} testID="app-menu">
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => select(item)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.detail}
            testID={`menu-${item.key}`}
          >
            <Text style={styles.label}>{item.label}</Text>
            <Text style={type.detail}>{item.detail}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.sm, marginBottom: space.lg },
  item: { minHeight: touch + 12, justifyContent: 'center', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  pressed: { opacity: 0.6 },
  label: { fontSize: 17, fontWeight: '700', color: colors.ink },
});
