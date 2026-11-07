import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from './theme';

/** Renders a bundled SVG illustration at full width, keeping its 4:3 aspect ratio (never cropped). */
export function Illustration({ xml, label, style }: { xml: string; label: string; style?: StyleProp<ViewStyle> }) {
  const { colors, type } = useTheme();

  return (
    <View style={[{ width: '100%', aspectRatio: 4 / 3 }, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      <SvgXml xml={xml} width="100%" height="100%" color={colors.ink} />
    </View>
  );
}
