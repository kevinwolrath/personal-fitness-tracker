import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatShortDate } from '../../format';
import { formatMinutes } from '../../observations/units';
import { addDays, toLocalDate, type LocalDate } from '../../plan/dates';
import { useApp } from '../../providers/AppProvider';
import { formatReviewValue, type ReviewedCandidate } from '../../observations/review';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { takeHandedOffScreenshots, useImportSession, type PickedScreenshot } from './useImportSession';

const shownUnit = (u: string) => (u === 'count' || u === 'score' || u === 'min' ? '' : u); // durations carry h/m in the value
const isDate = (d: unknown): d is LocalDate => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Screenshot import: pick → read → review/edit → save with provenance (contract 06). */
export function ImportScreen() {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { store } = useApp();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = toLocalDate(new Date());
  const defaultDate = isDate(params.date) && params.date <= today ? params.date : today;
  const [initialShots] = useState(takeHandedOffScreenshots);
  const s = useImportSession({ store, defaultDate, today, initialShots });
  const [saveError, setSaveError] = useState<string | null>(null);

  const toRead = s.shots.filter((x) => x.input && x.status !== 'done' && x.status !== 'reading');
  const included = s.review.filter((c) => c.include).length;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const save = async () => {
    setSaveError(null);
    try {
      const n = await s.save();
      if (n !== null) close();
    } catch {
      setSaveError("Couldn't save. Try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <ModalHeader title="Import screenshots" dismiss={{ label: 'Cancel', onPress: close }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="import-scroll">
        {s.apiKey === undefined ? (
          <ActivityIndicator color={colors.muted} />
        ) : s.apiKey === null ? (
          <ApiKeyPanel onSave={s.saveApiKey} />
        ) : (
          <>
            <Text style={type.detail}>
              Pick screenshots from any fitness, sleep or scale app. Values are read by Claude, then you check them before
              anything is saved.
            </Text>

            {s.shots.length > 0 && (
              <View style={styles.thumbs}>
                {s.shots.map((shot) => (
                  <Thumb key={shot.asset.id} shot={shot} onRemove={() => s.removeShot(shot.asset.id)} />
                ))}
              </View>
            )}

            <View style={styles.actions}>
              {toRead.length > 0 ? (
                <Button
                  title={`Read ${toRead.length} screenshot${toRead.length > 1 ? 's' : ''}`}
                  variant={included ? 'secondary' : 'primary'} // once values are ready, Save is the one primary action
                  onPress={s.readAll}
                  disabled={s.reading}
                />
              ) : null}
              <Button
                title={s.shots.length ? 'Add more screenshots' : 'Choose screenshots'}
                variant={s.shots.length ? 'secondary' : 'primary'}
                onPress={s.pick}
                disabled={s.reading}
              />
            </View>
            {s.reading && (
              <View style={styles.readingRow} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.muted} />
                <Text style={type.detail}>Reading screenshots…</Text>
              </View>
            )}

            {s.shots
              .filter((x) => x.status === 'done' && x.mapped)
              .map((shot) => (
                <ShotReview
                  key={shot.asset.id}
                  shot={shot}
                  candidates={s.review.filter((c) => c.assetId === shot.asset.id)}
                  errors={s.errors}
                  today={today}
                  onEdit={s.editCandidate}
                  onDate={(d) => s.setShotDate(shot.asset.id, d)}
                />
              ))}

            <View style={styles.keyRow}>
              <Text style={[type.detail, styles.flex]}>Screenshots are read with your Anthropic API key, kept on this device.</Text>
              <Pressable onPress={s.forgetApiKey} style={styles.forget} accessibilityRole="button" accessibilityLabel="Forget API key">
                <Text style={[type.detail, styles.forgetText]}>Forget key</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {s.apiKey && s.review.length > 0 ? (
        <View style={styles.footer}>
          {saveError && <Text style={[type.detail, styles.error]}>{saveError}</Text>}
          <Button
            title={included ? `Save ${included} value${included > 1 ? 's' : ''}` : 'Nothing to save yet'}
            onPress={save}
            disabled={!included || s.saving || s.reading}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ApiKeyPanel({ onSave }: { onSave: (key: string) => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const [key, setKey] = useState('');
  return (
    <View style={styles.keyPanel}>
      <Text style={type.body}>Connect screenshot reading</Text>
      <Text style={type.detail}>
        Screenshots are sent to Anthropic's Claude API to read the numbers. Paste your Anthropic API key. It's stored only on
        this device and used only when you import.
      </Text>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="sk-ant-…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.keyInput}
        accessibilityLabel="Anthropic API key"
      />
      <Button title="Save key" onPress={() => onSave(key)} disabled={key.trim().length < 10} />
    </View>
  );
}

function Thumb({ shot, onRemove }: { shot: PickedScreenshot; onRemove: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const status =
    shot.status === 'reading' ? 'Reading…' : shot.status === 'done' ? shot.asset.sourceApp ?? 'Read' : shot.status === 'failed' ? 'Problem' : 'Ready';
  return (
    <View style={styles.thumb} testID={`shot-${shot.asset.fileName ?? shot.asset.id}`}>
      <Image source={{ uri: shot.uri }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
      <Text style={[type.detail, styles.thumbStatus]} numberOfLines={1}>
        {status}
      </Text>
      {shot.error && (
        <Text style={[type.detail, styles.error]} numberOfLines={3}>
          {shot.error}
        </Text>
      )}
      <Pressable
        onPress={onRemove}
        style={styles.thumbRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${shot.asset.fileName ?? 'screenshot'}`}
        disabled={shot.status === 'reading'}
      >
        <Text style={styles.thumbRemoveText}>✕</Text>
      </Pressable>
    </View>
  );
}

function ShotReview(p: {
  shot: PickedScreenshot;
  candidates: ReviewedCandidate[];
  errors: Record<string, string>;
  today: LocalDate;
  onEdit: (key: string, patch: Partial<ReviewedCandidate>) => void;
  onDate: (d: LocalDate) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const date = p.candidates[0]?.date;
  const observed = p.candidates.filter((c) => c.kind === 'observed');
  const inferred = p.candidates.filter((c) => c.kind === 'inferred');
  const title = p.shot.asset.sourceApp ?? p.shot.asset.fileName ?? 'Screenshot';
  return (
    <View style={styles.section} testID={`review-${p.shot.asset.fileName ?? p.shot.asset.id}`}>
      <View style={styles.sectionHeader}>
        <Text style={[type.section, styles.sectionTitle]} numberOfLines={1}>
          {title}
        </Text>
        {date && (
          <View style={styles.dateStepper}>
            <Pressable onPress={() => p.onDate(addDays(date, -1))} style={styles.step} accessibilityRole="button" accessibilityLabel={`${title}: previous day`}>
              <Text style={styles.stepText}>‹</Text>
            </Pressable>
            <Text style={[type.detail, styles.dateText]}>{formatShortDate(date)}</Text>
            <Pressable
              onPress={() => p.onDate(addDays(date, 1))}
              disabled={date >= p.today}
              style={[styles.step, date >= p.today && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={`${title}: next day`}
            >
              <Text style={styles.stepText}>›</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!p.candidates.length && <Text style={type.detail}>No fitness values found in this screenshot.</Text>}
      {observed.map((c) => (
        <CandidateRow key={c.key} c={c} error={p.errors[c.key]} onEdit={p.onEdit} />
      ))}
      {inferred.length > 0 && (
        <>
          <Text style={[type.detail, styles.inferredNote]}>
            Calculated from other numbers, not shown on screen. If you include these, they're saved as calculated, never as a
            measurement.
          </Text>
          {inferred.map((c) => (
            <CandidateRow key={c.key} c={c} error={p.errors[c.key]} onEdit={p.onEdit} />
          ))}
        </>
      )}
      {p.shot.mapped!.dropped.length > 0 && (
        <Text style={[type.detail, styles.dropped]}>Not used: {p.shot.mapped!.dropped.join('; ')}</Text>
      )}
    </View>
  );
}

function CandidateRow({ c, error, onEdit }: { c: ReviewedCandidate; error?: string; onEdit: (key: string, patch: Partial<ReviewedCandidate>) => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const text = c.editedText ?? formatReviewValue(c.unit, c.value);
  const meta = [`“${c.evidence}”`, c.confidence < 0.8 ? 'check this' : null].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, !c.include && styles.rowExcluded]} testID={`candidate-${c.metric}`}>
      <Pressable
        onPress={() => onEdit(c.key, { include: !c.include })}
        style={styles.check}
        role="checkbox"
        aria-checked={c.include}
        aria-label={`Include ${c.label}${c.kind === 'inferred' ? ' (calculated)' : ''}`}
      >
        <View style={[styles.box, c.include && styles.boxOn]}>{c.include && <Text style={styles.tick}>✓</Text>}</View>
      </Pressable>
      <View style={styles.rowText}>
        <Text style={type.body} numberOfLines={1}>
          {c.label}
        </Text>
        <Text style={type.detail} numberOfLines={2}>
          {meta}
        </Text>
        {error && <Text style={[type.detail, styles.error]}>{error}</Text>}
      </View>
      <TextInput
        value={text}
        onChangeText={(t) => onEdit(c.key, { editedText: t })}
        keyboardType={c.unit === 'min' ? 'default' : 'decimal-pad'} // durations read "7h 45m"
        editable={c.include}
        style={[styles.valueInput, error && styles.valueInputError]}
        accessibilityLabel={`${c.label} value`}
      />
      <Text style={styles.unit}>{shownUnit(c.unit)}</Text>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.lg },
  link: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.lg },
  actions: { gap: space.sm },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  keyPanel: { gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg },
  keyInput: {
    minHeight: touch,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.ink,
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 96, gap: 2 },
  thumbImage: { width: 96, height: 128, borderRadius: radius.sm, backgroundColor: colors.line },
  thumbStatus: { fontSize: 13 },
  thumbRemove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: touch,
    height: touch,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 4,
  },
  thumbRemoveText: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.ink,
    color: colors.onAccent,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 12,
  },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: touch },
  sectionTitle: { flex: 1 },
  dateStepper: { flexDirection: 'row', alignItems: 'center' },
  step: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 24, color: colors.ink },
  dateText: { minWidth: 84, textAlign: 'center' },
  disabled: { opacity: 0.3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  rowExcluded: { opacity: 0.55 },
  check: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', marginLeft: -space.md },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontWeight: '900', fontSize: 13 },
  rowText: { flex: 1, minWidth: 0 },
  valueInput: {
    width: 88,
    minHeight: touch,
    textAlign: 'right',
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    fontVariant: ['tabular-nums'],
  },
  valueInputError: { borderBottomColor: colors.ink },
  unit: { width: 36, fontSize: 14, color: colors.muted },
  inferredNote: { marginTop: space.md, fontStyle: 'italic' },
  dropped: { marginTop: space.sm, marginBottom: space.xs },
  error: { color: colors.ink, fontWeight: '700' },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  flex: { flex: 1 },
  forget: { minHeight: touch, minWidth: touch, alignItems: 'center', justifyContent: 'center' },
  forgetText: { textDecorationLine: 'underline' },
}));
