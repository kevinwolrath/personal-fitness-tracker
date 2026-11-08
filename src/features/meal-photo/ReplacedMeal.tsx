import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { EnergyDisplay } from '../../energy';
import type { MealLog, MealPhoto } from '../../nutrition/contract';
import { formatNutrients, mealSummary, sourceTag } from '../../nutrition/format';
import { photoSource } from '../../platform/mealPhotos';
import { Button } from '../../ui/Button';
import { radius, space, useTheme, createThemedStyles } from '../../ui/theme';
import { PhotoViewer } from './PhotoViewer';

const amount = (q: number | null, u: string | null) => (q === null ? (u ? u : null) : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(q)}${u ? ` ${u}` : ''}`);

/**
 * What was actually eaten instead of a scheduled meal (#97), in the meal's sheet: the source (photo estimate or
 * typed in), the foods with their amounts, totals from the foods, the photos (tap for full screen), Edit and Remove.
 */
export function ReplacedMeal({ log, energy, editable, onEdit, onRemove }: { log: MealLog; energy: EnergyDisplay; editable: boolean; onEdit: () => void; onRemove: () => void }) {
  const styles = useStyles();
  const { type } = useTheme();
  const [viewing, setViewing] = useState<MealPhoto | null>(null);
  return (
    <View style={styles.wrap} testID="replaced-meal">
      <Text style={type.section}>What you ate instead</Text>
      <View style={styles.titleRow}>
        <Text style={[type.body, styles.flex]}>{log.name}</Text>
        <Text style={styles.tag}>{log.photos.length ? '📷 ' : ''}{sourceTag(log)}</Text>
      </View>
      <Text style={type.detail} testID="replaced-meal-summary">{mealSummary(log, energy, true) ?? 'No amounts known'}</Text>
      {log.confidence && <Text style={type.detail}>AI confidence: {log.confidence}{log.edited ? ' · edited by you' : ''}</Text>}
      <View style={styles.items}>
        {log.items.map((i, n) => (
          <View key={n} style={styles.item}>
            <Text style={[type.detail, styles.itemName]} numberOfLines={2}>{[i.name, amount(i.quantity, i.unit)].filter(Boolean).join(' · ')}</Text>
            <Text style={[type.detail, styles.itemValue]}>{formatNutrients(i, energy)?.replace('≈ ', '') ?? '—'}</Text>
          </View>
        ))}
      </View>
      {log.assumptions.length > 0 && <Text style={type.detail}>Assumed: {log.assumptions.join('; ')}</Text>}
      {log.uncertainties.length > 0 && <Text style={type.detail}>Unsure: {log.uncertainties.join('; ')}</Text>}
      {log.photos.length > 0 && (
        <View style={styles.photos}>
          {log.photos.map((p, i) => {
            const src = photoSource(p.uri);
            return (
              <Pressable key={p.id} onPress={() => setViewing(p)} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1}, view full screen`} testID={`replaced-photo-${i}`}>
                {src ? <Image source={{ uri: src }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.missing]}><Text style={styles.missingText}>Missing</Text></View>}
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={type.detail}>An estimate, not a measurement. The plan’s recipe isn’t counted as eaten.</Text>
      {editable && (
        <View style={styles.actions}>
          <Button title="Edit meal" variant="secondary" onPress={onEdit} testID="replaced-meal-edit" />
          <Button title="Remove meal" variant="secondary" onPress={onRemove} testID="replaced-meal-remove" />
        </View>
      )}
      <PhotoViewer photo={viewing} missing={!!viewing && !photoSource(viewing.uri)} onClose={() => setViewing(null)} />
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  wrap: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  tag: { fontSize: 12, fontWeight: '700', color: colors.muted, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  items: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm },
  item: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  itemName: { flex: 1, color: colors.ink },
  itemValue: { textAlign: 'right' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.line },
  missing: { alignItems: 'center', justifyContent: 'center' },
  missingText: { fontSize: 11, color: colors.muted },
  actions: { gap: space.sm, marginTop: space.xs },
}));
