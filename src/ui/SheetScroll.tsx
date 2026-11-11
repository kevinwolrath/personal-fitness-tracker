import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ScrollView } from './ScrollView';

/**
 * The scrollable part of a sheet (#142). Put it after the sheet's fixed header: it shrinks to the space the sheet
 * has left (the panel is at most 92% of the screen) and scrolls, so the last row can always be scrolled fully into
 * view above the sheet's bottom inset. Short content takes only its own height: no permanent blank space.
 */
export function SheetScroll({ children, contentContainerStyle, testID }: { children: ReactNode; contentContainerStyle?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled" testID={testID}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ scroll: { flexGrow: 0, flexShrink: 1 } });
