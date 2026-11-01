import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ExerciseGuide } from '../../exercises/guide';
import { illustrations } from '../../exercises/illustrations.generated';
import { Illustration } from '../../ui/Illustration';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { colors, radius, space, touch, type } from '../../ui/theme';

type Props = { guide: ExerciseGuide | null; onClose: () => void };

/**
 * "Show me how to do this exercise" (contract 09). Read-only: browsing never changes completion.
 * Render it inside the sheet that opens it (sheets nest) so closing returns to exactly that context.
 */
export function ExerciseGuideSheet({ guide, onClose }: Props) {
  const steps = (guide?.steps ?? []).filter((s) => illustrations[s.image]);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const pager = useRef<ScrollView>(null);

  useEffect(() => setIndex(0), [guide?.movement]); // always start on the first step

  const go = (i: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setIndex(next);
    pager.current?.scrollTo({ x: next * width, animated: true });
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <Sheet visible={!!guide} onClose={onClose} label={guide ? `How to do ${guide.name}` : 'Exercise guide'} fill>
      {guide && (
        <View style={styles.body} testID="exercise-guide">
          <ModalHeader title={guide.name} titleTestID="guide-title" dismiss={{ label: 'Close', a11yLabel: 'Close guide', onPress: onClose }} />

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={type.detail} testID="guide-prescription">
              {[guide.prescription ? `Today: ${guide.prescription}` : null, guide.workoutLabel].filter(Boolean).join(' · ')}
            </Text>
            {guide.substitutedFor && <Text style={styles.note}>Instead of {guide.substitutedFor.toLowerCase()}, as set in your exercise configuration</Text>}
            {guide.caution && <Text style={styles.note}>{guide.caution}</Text>}

            {steps.length > 0 ? (
              <View>
                <View style={styles.pagerFrame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="guide-pager">
                  <ScrollView
                    ref={pager}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={onScrollEnd}
                    onScrollEndDrag={onScrollEnd}
                    scrollEnabled={steps.length > 1}
                  >
                    {steps.map((s, i) => (
                      <View key={s.image} style={{ width: width || undefined }}>
                        <Illustration xml={illustrations[s.image]} label={`${guide.name}, step ${i + 1}: ${s.caption}`} />
                      </View>
                    ))}
                  </ScrollView>
                </View>

                {steps.length > 1 && (
                  <View style={styles.nav}>
                    <Pressable
                      onPress={() => go(index - 1)}
                      disabled={index === 0}
                      style={[styles.navButton, index === 0 && styles.disabled]}
                      accessibilityRole="button"
                      accessibilityLabel="Previous step"
                    >
                      <Text style={styles.navText}>‹</Text>
                    </Pressable>
                    <View style={styles.position}>
                      <Text style={styles.positionText} testID="guide-position" aria-live="polite">
                        {index + 1} / {steps.length}
                      </Text>
                      <View style={styles.dots}>
                        {steps.map((s, i) => (
                          <View key={s.image} style={[styles.dot, i === index && styles.dotOn]} />
                        ))}
                      </View>
                    </View>
                    <Pressable
                      onPress={() => go(index + 1)}
                      disabled={index === steps.length - 1}
                      style={[styles.navButton, index === steps.length - 1 && styles.disabled]}
                      accessibilityRole="button"
                      accessibilityLabel="Next step"
                    >
                      <Text style={styles.navText}>›</Text>
                    </Pressable>
                  </View>
                )}
                <Text style={styles.caption} testID="guide-caption">
                  {steps[index]?.caption}
                </Text>
              </View>
            ) : (
              <Text style={[type.detail, styles.noImage]} testID="guide-no-image">
                {guide.hasDefinition ? 'No illustration for this exercise yet.' : 'No guide for this exercise yet.'}
              </Text>
            )}

            {guide.equipment.length > 0 && (
              <View style={styles.block}>
                <Text style={type.section}>Equipment</Text>
                <Text style={type.body} testID="guide-equipment">
                  {guide.equipment.join(' · ')}
                </Text>
              </View>
            )}
            {guide.instructions.length > 0 && (
              <View style={styles.block} testID="guide-instructions">
                <Text style={type.section}>How to</Text>
                {guide.instructions.map((line, i) => (
                  <View key={i} style={styles.instruction}>
                    <Text style={styles.bullet}>{i + 1}</Text>
                    <Text style={styles.instructionText}>{line}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.xl },
  note: { ...type.detail, color: colors.ink },
  pagerFrame: { width: '100%', borderRadius: radius.md, backgroundColor: colors.bg, overflow: 'hidden' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  navButton: { width: touch, height: touch, borderRadius: touch / 2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 26, color: colors.ink, lineHeight: 28 },
  disabled: { opacity: 0.3 },
  position: { alignItems: 'center', gap: 4 },
  positionText: { fontSize: 15, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.accent },
  caption: { ...type.body, fontSize: 16, marginTop: space.sm },
  noImage: { paddingVertical: space.lg },
  block: { gap: space.xs },
  instruction: { flexDirection: 'row', gap: space.sm },
  bullet: { width: 20, fontSize: 15, fontWeight: '800', color: colors.accent },
  instructionText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.ink },
});
