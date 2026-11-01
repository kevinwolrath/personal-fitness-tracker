import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from './theme';

/** Web is a phone-shaped test surface: max 430 px column, centred (contract 05). */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.phone} testID="phone-frame">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: 'center' },
  phone: { flex: 1, width: '100%', maxWidth: 430, backgroundColor: colors.bg, overflow: 'hidden' },
});
