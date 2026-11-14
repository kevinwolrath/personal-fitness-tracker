import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatShortDate, localIsoTimestamp } from '../../format';
import { defaultContext, parseShared, quickErrors, quickMealLog, usableContext, type QuickContext, type QuickFields, type QuickParse } from '../../nutrition/quickLog';
import { replacementCompletion } from '../../nutrition/replace';
import { toLocalDate } from '../../plan/dates';
import * as files from '../../platform/mealPhotos';
import { useApp } from '../../providers/AppProvider';
import { newId } from '../../storage/types';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { readPending } from './takeMealPhoto';

type Ready = { ctx: QuickContext; parsed: QuickParse };

/**
 * The return page (#183): an AI's result shared to Body Anvil lands here. Description and Energy (kJ), prefilled by
 * the existing parser and editable inline, and one Save. No wizard, ingredient editor, preview or confirmation. The
 * day and meal come from the photo that started it (or, without one, an extra meal today). Save writes once.
 */
export function MealReturnScreen() {
  const { store, plan, notifyDataChanged } = useApp();
  const { type, colors } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ text?: string }>();
  const text = typeof params.text === 'string' ? params.text : '';
  const [ready, setReady] = useState<Ready | null>(null);
  const [fields, setFields] = useState<QuickFields>({ description: '', energyKj: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof QuickFields, string>>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const now = new Date();
      const stamp = localIsoTimestamp();
      const today = toLocalDate(now);
      const ctx = usableContext(await readPending(), now, today) ?? defaultContext(newId(), today, stamp);
      const parsed = parseShared(text, ctx, stamp);
      if (!live) return;
      setReady({ ctx, parsed });
      setFields(parsed.fields);
      // Only what couldn't be read is flagged; a prefilled field shows no message.
      setErrors(parsed.problems);
    })();
    return () => {
      live = false;
    };
  }, [text]);

  const back = (date: string) => {
    const href = date === toLocalDate(new Date()) ? '/' : (`/?date=${date}` as const);
    if (router.canDismiss()) router.dismissTo(href);
    else router.replace(href);
  };

  const save = async () => {
    if (!ready || busy.current) return;
    const problems = quickErrors(fields);
    if (Object.keys(problems).length) return setErrors(problems);
    busy.current = true;
    setSaving(true);
    try {
      const { ctx, parsed } = ready;
      const now = localIsoTimestamp();
      const sameDay = await store.mealLogs({ from: ctx.date, to: ctx.date });
      // A scheduled meal already replaced (or this exact meal saved before) is updated, never counted twice.
      const existing = sameDay.find((m) => m.id === ctx.id) ?? (ctx.activityId ? sameDay.find((m) => m.activityId === ctx.activityId && m.planId === ctx.planId) : undefined);
      const r = quickMealLog(parsed, fields, ctx, now, existing ?? null);
      if (!r.ok) return setErrors(r.errors);
      const completion = ctx.activityId && ctx.planId === plan.id && !existing ? replacementCompletion(plan, ctx.date, await store.getDay(plan.id, ctx.date), ctx.activityId, true, now) : null;
      await store.saveMealLog(r.log, completion);
      // A replaced meal's earlier photos that this one doesn't keep are no longer referenced.
      await Promise.all((existing?.photos ?? []).filter((p) => !r.log.photos.some((q) => q.id === p.id)).map((p) => files.deletePhoto(p.uri)));
      await files.clearPendingShare();
      notifyDataChanged();
      back(ctx.date);
    } catch {
      setNotice("Couldn't save. Your entries are kept: try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const edit = (patch: Partial<QuickFields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  };

  const ctx = ready?.ctx;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID="meal-return">
      <View style={styles.header}>
        <ModalHeader title="Log meal" dismiss={{ label: 'Cancel', a11yLabel: 'Cancel logging this meal', onPress: () => back(ctx?.date ?? toLocalDate(new Date())) }} />
      </View>
      {!ready ? (
        <ActivityIndicator style={styles.loading} color={colors.muted} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="meal-return-scroll">
          <Text style={type.detail} testID="meal-return-context">
            {`${ctx!.replacedLabel ? `Replaces ${ctx!.replacedLabel}` : 'Extra meal'} · ${formatShortDate(ctx!.date)}`}
          </Text>
          <View style={styles.field}>
            <Text style={type.section} nativeID="desc-label">Description</Text>
            <TextInput
              value={fields.description}
              onChangeText={(description) => edit({ description })}
              multiline
              placeholder="What you ate"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.description, errors.description && styles.inputError]}
              accessibilityLabel="Description"
              testID="meal-return-description"
            />
            {errors.description && <Text style={styles.error} testID="meal-return-description-error">{errors.description}</Text>}
          </View>
          <View style={styles.field}>
            <Text style={type.section}>Energy (kJ)</Text>
            <TextInput
              value={fields.energyKj}
              onChangeText={(energyKj) => edit({ energyKj })}
              keyboardType="numeric"
              placeholder="kJ"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.energy, errors.energyKj && styles.inputError]}
              accessibilityLabel="Energy in kilojoules"
              testID="meal-return-energy"
            />
            {errors.energyKj && <Text style={styles.error} testID="meal-return-energy-error">{errors.energyKj}</Text>}
          </View>
          {ready.parsed.proteinG !== null && <Text style={type.detail} testID="meal-return-protein">{`Protein ≈ ${ready.parsed.proteinG} g from the estimate is kept.`}</Text>}
          {notice && <Text style={styles.error} accessibilityLiveRegion="polite">{notice}</Text>}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <Button title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={!ready || saving} testID="meal-return-save" />
      </View>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm },
  loading: { marginTop: space.xxl },
  body: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.lg },
  field: { gap: space.xs },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: space.md, color: colors.ink, backgroundColor: colors.surface },
  description: { minHeight: touch * 2, paddingVertical: space.sm, fontSize: 18, fontWeight: '700', textAlignVertical: 'top' },
  energy: { minHeight: touch + 8, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  inputError: { borderColor: colors.injured },
  error: { ...type.detail, color: colors.ink, borderLeftWidth: 3, borderLeftColor: colors.injured, paddingLeft: space.sm },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
}));
