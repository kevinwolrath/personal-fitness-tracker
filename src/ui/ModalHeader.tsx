import { Pressable, StyleSheet, Text, View } from 'react-native';
import { space, touch, useTheme, createThemedStyles } from './theme';

type Action = { label: string; onPress: () => void; disabled?: boolean };

type Props = {
  title: string;
  /**
   * Always on the left. "Cancel" when closing loses something (an unsaved value, a pasted update),
   * "Close" when the surface is read-only or already saved, "Back" on a nested page such as a Settings subpage (contract 02 "Modal and sheet header").
   */
  dismiss: { label: 'Cancel' | 'Close' | 'Back'; onPress: () => void; /** Fuller screen-reader label, e.g. "Close guide". */ a11yLabel?: string };
  /** The surface's confirm (Save), on the right. Omitted on read-only surfaces. */
  confirm?: Action;
  titleTestID?: string;
};

/** The one header for every modal screen and sheet: dismiss left, centred title, confirm right. */
export function ModalHeader({ title, dismiss, confirm, titleTestID }: Props) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.header} testID="modal-header">
      <View style={styles.side}>
        <Pressable onPress={dismiss.onPress} style={styles.button} accessibilityRole="button" accessibilityLabel={dismiss.a11yLabel ?? dismiss.label} testID="modal-dismiss">
          <Text style={styles.text}>{dismiss.label}</Text>
        </Pressable>
      </View>
      <Text style={[type.body, styles.title]} accessibilityRole="header" numberOfLines={1} testID={titleTestID ?? 'modal-title'}>
        {title}
      </Text>
      <View style={[styles.side, styles.right]}>
        {confirm && (
          <Pressable
            onPress={confirm.onPress}
            disabled={confirm.disabled}
            style={[styles.button, styles.buttonRight]}
            accessibilityRole="button"
            accessibilityLabel={confirm.label}
            testID="modal-confirm"
          >
            <Text style={[styles.text, styles.strong, confirm.disabled && styles.disabled]}>{confirm.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: touch, marginBottom: space.sm },
  // Equal sides keep the title centred whether or not there is a confirm.
  side: { width: 88, flexDirection: 'row' },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  button: { minHeight: touch, minWidth: touch, justifyContent: 'center' },
  buttonRight: { alignItems: 'flex-end' },
  text: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  strong: { fontWeight: '800' },
  disabled: { color: colors.faint },
}));
