import { memo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import artwork from './artwork.generated.json';
import type { GymItem } from './catalogue';

/** Fixed-size, cached XML diagrams; collapsed groups/details never mount their images until opened. */
export const EquipmentImage = memo(({ item, large = false, size = 58 }: { item: GymItem; large?: boolean; size?: number }) => (
  <View style={{ width: large ? '100%' : size, height: large ? 240 : size }} accessible accessibilityRole="image" accessibilityLabel={item.name}>
    <SvgXml xml={(artwork as Record<string, string>)[item.image]} width="100%" height="100%" accessible={false} />
  </View>
));
