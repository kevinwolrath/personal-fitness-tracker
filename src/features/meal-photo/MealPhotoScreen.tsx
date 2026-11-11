import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatShortDate } from '../../format';
import { nutrientKeys, nutrientLabels, type MealPhoto } from '../../nutrition/contract';
import { liveItems, STEPS, type DraftItem, type Step } from '../../nutrition/draft';
import { energyMismatch, mealTotals, totalsDiscrepancies } from '../../nutrition/totals';
import { toLocalDate } from '../../plan/dates';
import { photoSource } from '../../platform/mealPhotos';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { MAX_PHOTOS, openSettings, useMealPhoto, type Pickers } from './useMealPhoto';
import { PhotoViewer } from './PhotoViewer';

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

const titles: Record<Step, string> = { capture: 'Add a photo', photos: 'Check the photos', share: 'Ask an AI', paste: 'Paste the reply', review: 'Check the estimate' };
const grouped = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

/**
 * "Log different meal" (#97, contract 15, layout B): a full-screen modal, one step per screen.
 * Capture → photos → share with AI → paste the reply → review and save. The draft survives leaving for the AI app.
 */
export function MealPhotoScreen({ pickers }: { pickers?: Pickers } = {}) {
  const { store, plan, notifyDataChanged } = useApp();
  const styles = useStyles();
  const { colors, type } = useTheme();
  const params = useLocalSearchParams<{ date?: string; activity?: string; edit?: string; input?: string }>();
  const today = toLocalDate(new Date());
  // Today and past days only (contract 04 editable window): a future date falls back to today.
  const date = isDate(params.date) && params.date <= today ? params.date : today;
  const target = useMemo(() => ({ date, activityId: params.activity ?? null, editId: params.edit ?? null }), [date, params.activity, params.edit]);
  const m = useMealPhoto({ store, plan, target, pickers, initialInput: typeof params.input === 'string' ? params.input : undefined });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [viewing, setViewing] = useState<MealPhoto | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace(date === today ? '/' : `/?date=${date}`));
  const cancel = async () => {
    setConfirmCancel(false);
    await m.actions.cancel();
    close();
  };
  const save = async () => {
    const log = await m.actions.save();
    if (!log) return;
    notifyDataChanged();
    close();
  };

  if (m.status.kind === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <ActivityIndicator color={colors.muted} style={styles.loading} />
      </SafeAreaView>
    );
  }
  if (m.status.kind === 'not-found') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}><ModalHeader title="Meal" dismiss={{ label: 'Close', onPress: close }} /></View>
        <Text style={[type.body, styles.pad]}>This meal isn’t saved any more. It may have been removed.</Text>
      </SafeAreaView>
    );
  }
  if (m.status.kind === 'other-draft') {
    const o = m.status.other;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}><ModalHeader title="Unsaved meal" dismiss={{ label: 'Close', onPress: close }} /></View>
        <View style={styles.pad} testID="meal-other-draft">
          <Text style={type.body}>You have an unsaved meal{o.replacedLabel ? ` for ${o.replacedLabel}` : ''} from {formatShortDate(o.date)}.</Text>
          <Text style={[type.detail, styles.gapTop]}>Only one meal can be in progress. Continue it, or discard it (its {o.addedPhotoIds.length} new photo{o.addedPhotoIds.length === 1 ? '' : 's'} will be deleted).</Text>
          <View style={styles.stack}>
            <Button title="Continue that meal" onPress={() => m.actions.resolveOther('continue')} />
            <Button title="Discard it and start this one" variant="secondary" onPress={() => m.actions.resolveOther('discard')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const d = m.draft!;
  const stepIndex = STEPS.indexOf(d.step);
  const dismissLabel = m.hasWork ? 'Cancel' : 'Close';
  const onDismiss = () => (m.hasWork ? setConfirmCancel(true) : cancel());
  const what = d.mode === 'edit' ? `Editing ${d.name || 'meal'}` : d.replacedLabel ? `Replaces ${d.replacedLabel}` : 'Extra meal';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID="meal-photo">
      <View style={styles.header}>
        <ModalHeader title={titles[d.step]} dismiss={{ label: dismissLabel, onPress: onDismiss, a11yLabel: `${dismissLabel} logging this meal` }} />
        <View style={styles.strip} accessibilityLabel={`Step ${stepIndex + 1} of ${STEPS.length}`} testID="meal-steps">
          {STEPS.map((s, i) => <View key={s} style={[styles.stripPart, i <= stepIndex && styles.stripOn]} />)}
        </View>
        <Text style={[type.detail, styles.context]} numberOfLines={1} testID="meal-context">
          Step {stepIndex + 1} of {STEPS.length} · {what} · {formatShortDate(d.date)}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="meal-scroll">
        {m.notice && (
          <View style={styles.notice} testID="meal-notice" accessibilityLiveRegion="polite">
            <Text style={styles.noticeText}>{m.notice}</Text>
          </View>
        )}
        {d.step === 'capture' && <CaptureStep m={m} />}
        {d.step === 'photos' && <PhotosStep m={m} onView={setViewing} />}
        {d.step === 'share' && <ShareStep m={m} />}
        {d.step === 'paste' && <PasteStep m={m} />}
        {d.step === 'review' && <ReviewStep m={m} onView={setViewing} />}
      </ScrollView>

      <BottomBar m={m} onSave={save} />

      <PhotoViewer
        photo={viewing}
        missing={!!viewing && m.missing.includes(viewing.id)}
        onClose={() => setViewing(null)}
        onDelete={() => {
          if (viewing) m.actions.removePhoto(viewing.id);
          setViewing(null);
        }}
      />
      <ConfirmDialog
        visible={confirmCancel}
        title={d.mode === 'edit' ? 'Discard your changes?' : 'Discard this meal?'}
        message={d.mode === 'edit' ? 'The saved meal stays as it was. New photos you added here are deleted.' : 'Nothing is saved. Photos you took here are deleted.'}
        confirmLabel="Discard"
        cancelLabel="Keep going"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={cancel}
      />
    </SafeAreaView>
  );
}

type M = ReturnType<typeof useMealPhoto>;

function CaptureStep({ m }: { m: M }) {
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <View style={styles.stack}>
      <BigChoice icon="📷" title="Take a photo" sub="Opens the camera" onPress={() => m.actions.addPhotos('camera')} testID="meal-camera" />
      <BigChoice icon="🖼" title="Choose from gallery" sub={`Up to ${MAX_PHOTOS} photos you already took`} onPress={() => m.actions.addPhotos('library')} testID="meal-library" />
      {m.cameraDenied && (
        <View style={styles.warn} testID="meal-camera-denied">
          <Text style={styles.warnText}>
            <Text style={styles.warnStrong}>Camera access is off. </Text>
            {m.cameraDenied.canAskAgain ? 'Allow it when asked, or choose a photo from the gallery instead.' : 'Allow it in the phone’s settings, or choose a photo from the gallery instead.'}
          </Text>
          {!m.cameraDenied.canAskAgain && <LinkButton title="Open settings" onPress={openSettings} />}
        </View>
      )}
      <Text style={type.detail}>🔒 Photos stay in this app on this phone. They leave it only when you tap Share with AI and pick an app.</Text>
      {(m.draft?.photos.length ?? 0) === 0 && <LinkButton title="No photo? Enter the numbers yourself" onPress={m.actions.enterManually} testID="meal-manual" />}
    </View>
  );
}

function PhotosStep({ m, onView }: { m: M; onView: (p: MealPhoto) => void }) {
  const styles = useStyles();
  const { type } = useTheme();
  const d = m.draft!;
  return (
    <View style={styles.stack}>
      <Text style={type.detail}>Tap a photo to see it full screen or delete it. Add another angle if part of the meal is hidden.</Text>
      <PhotoGrid photos={d.photos} missing={m.missing} onView={onView} onRemove={m.actions.removePhoto} large />
      {d.photos.length < MAX_PHOTOS && (
        <View style={styles.row}>
          <View style={styles.flex}><Button title="📷 Retake / add" variant="secondary" onPress={() => m.actions.addPhotos('camera')} accessibilityLabel="Take another photo" /></View>
          <View style={styles.flex}><Button title="🖼 Gallery" variant="secondary" onPress={() => m.actions.addPhotos('library')} accessibilityLabel="Add a photo from the gallery" /></View>
        </View>
      )}
    </View>
  );
}

function ShareStep({ m }: { m: M }) {
  const styles = useStyles();
  const { type } = useTheme();
  const [showPrompt, setShowPrompt] = useState(false);
  const d = m.draft!;
  const shareable = d.photos.filter((p) => !m.missing.includes(p.id));
  const first = shareable[0];
  const src = first ? photoSource(first.uri) : null;
  return (
    <View style={styles.stack}>
      {src ? <Image source={{ uri: src }} style={styles.hero} resizeMode="cover" accessibilityLabel="Your meal photo" /> : null}
      <Text style={type.detail}>
        Share with AI copies the nutrition prompt, then opens your phone’s share sheet with the photo. Pick ChatGPT, Claude or another app, paste the prompt in
        the same chat, then copy the AI’s whole reply.
      </Text>
      {shareable.length > 1 && (
        <View style={styles.stack}>
          <Text style={type.detail}>Your phone shares one photo at a time. After the first, share the others into the same chat:</Text>
          {shareable.slice(1).map((p, i) => (
            <Button key={p.id} title={`Share photo ${i + 2} of ${shareable.length}`} variant="secondary" onPress={() => m.actions.share(i + 1)} />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <LinkButton title="Copy prompt only" onPress={m.actions.copyPrompt} testID="meal-copy-prompt" />
        <LinkButton title={showPrompt ? 'Hide the prompt' : 'See the prompt'} onPress={() => setShowPrompt((v) => !v)} testID="meal-see-prompt" />
      </View>
      {showPrompt && <Text style={styles.prompt} selectable testID="meal-prompt">{m.prompt}</Text>}
      <Text style={type.detail}>🔒 Nothing is sent by this app. The AI app you pick receives only what you share there. Its estimate is a guess from a photo.</Text>
    </View>
  );
}

function PasteStep({ m }: { m: M }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const d = m.draft!;
  return (
    <View style={styles.stack}>
      <Text style={type.detail}>Paste the AI’s whole reply. Text around the JSON is fine. Nothing pasted is run: the app only reads the numbers.</Text>
      <TextInput
        value={d.reply}
        onChangeText={m.actions.setReply}
        multiline
        placeholder="Paste the AI’s reply here"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.paste}
        accessibilityLabel="AI reply"
        testID="meal-reply"
      />
      <Button title="Paste from clipboard" variant="secondary" onPress={m.actions.pasteFromClipboard} />
      {d.replyError && (
        <View style={styles.error} testID="meal-reply-error" accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{d.replyError}</Text>
        </View>
      )}
      <LinkButton title="Enter the numbers myself instead" onPress={m.actions.enterManually} testID="meal-manual" />
    </View>
  );
}

function ReviewStep({ m, onView }: { m: M; onView: (p: MealPhoto) => void }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const d = m.draft!;
  const p = d.parsed;
  const items = liveItems(d.items);
  const totals = mealTotals(items);
  const discrepancies = totalsDiscrepancies(p?.aiTotals ?? null, totals);
  const unknownFoods = Math.max(0, ...Object.values(totals.unknown));
  const fieldError = (key: string, field: string) => m.errors.find((e) => e.key === key && e.field === field);
  return (
    <View style={styles.stack} testID="meal-review">
      {p?.confidence && (
        <Text style={styles.chip} testID="meal-confidence">{`${p.confidence[0].toUpperCase()}${p.confidence.slice(1)} confidence`}</Text>
      )}
      <TextInput
        value={d.name}
        onChangeText={m.actions.setName}
        placeholder="Meal name"
        placeholderTextColor={colors.faint}
        style={[styles.nameInput, fieldError('meal', 'name') && styles.inputError]}
        accessibilityLabel="Meal name"
        testID="meal-name"
      />
      <Text style={type.detail} testID="meal-caveat">
        {d.source === 'photo-ai' ? 'An AI’s estimate from a photo, not a measurement. Portions and hidden oil or sauce can make it well off. Edit anything that looks wrong.' : 'Your own entry. Leave a value empty if you don’t know it.'}
      </Text>

      <View style={styles.tiles} testID="meal-totals">
        {nutrientKeys.map((k) => (
          <View key={k} style={styles.tile}>
            <Text style={styles.tileValue}>{totals[k] === null ? '—' : `≈ ${grouped(totals[k]!)}`}</Text>
            <Text style={styles.tileLabel}>{k === 'energyKj' ? 'kJ' : `g ${nutrientLabels[k].label.toLowerCase()}`}</Text>
          </View>
        ))}
      </View>
      <Text style={type.detail}>Totals are added up from the foods below.</Text>

      {(discrepancies.length > 0 || unknownFoods > 0) && (
        <View style={styles.warn} testID="meal-discrepancies">
          <Text style={[styles.warnText, styles.warnStrong]}>Check the totals</Text>
          {discrepancies.map((x) => <Text key={x.key} style={styles.warnText}>{x.message}</Text>)}
          {unknownFoods > 0 && <Text style={styles.warnText}>Some foods have no number for a value, so its total may be low. Enter it if you know it.</Text>}
        </View>
      )}
      {p && (p.issues.length > 0 || p.repaired.length > 0) && (
        <View style={styles.warn} testID="meal-issues">
          <Text style={[styles.warnText, styles.warnStrong]}>From the AI’s reply</Text>
          {p.repaired.length > 0 && <Text style={styles.warnText}>Fixed {p.repaired.join(' and ')} so the reply could be read.</Text>}
          {p.issues.map((x) => <Text key={x.path + x.message} style={styles.warnText}>{x.message}</Text>)}
        </View>
      )}

      <Text style={type.section}>Foods</Text>
      {d.items.map((i, n) => (
        <ItemEditor key={i.key} item={i} index={n} onEdit={(patch) => m.actions.editItem(i.key, patch)} onRemove={() => m.actions.removeItem(i.key)} errorFor={(f) => fieldError(i.key, f)?.message} mismatch={energyMismatch(items[n])} />
      ))}
      <Button title="Add a food" variant="secondary" onPress={m.actions.addItem} />

      {p && (p.assumptions.length > 0 || p.uncertainties.length > 0) && (
        <View style={styles.stack} testID="meal-assumptions">
          {p.assumptions.length > 0 && <Text style={type.section}>Assumptions</Text>}
          {p.assumptions.map((a) => <Text key={a} style={type.detail}>• {a}</Text>)}
          {p.uncertainties.length > 0 && <Text style={type.section}>Unsure about</Text>}
          {p.uncertainties.map((a) => <Text key={a} style={type.detail}>• {a}</Text>)}
        </View>
      )}

      <Text style={type.section}>Photos</Text>
      {d.photos.length ? <PhotoGrid photos={d.photos} missing={m.missing} onView={onView} onRemove={m.actions.removePhoto} /> : <Text style={type.detail}>No photos.</Text>}
      {d.photos.length < MAX_PHOTOS && <LinkButton title="Add or change photos" onPress={() => m.actions.goTo('photos')} />}

      {m.errors.length > 0 && (
        <View style={styles.error} testID="meal-save-errors" accessibilityLiveRegion="polite">
          {m.errors.map((e, n) => <Text key={n} style={styles.errorText}>{e.message}</Text>)}
        </View>
      )}
    </View>
  );
}

function ItemEditor({ item, index, onEdit, onRemove, errorFor, mismatch }: { item: DraftItem; index: number; onEdit: (p: Partial<DraftItem>) => void; onRemove: () => void; errorFor: (f: string) => string | undefined; mismatch: number | null }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const label = item.name.trim() || `Food ${index + 1}`;
  return (
    <View style={styles.item} testID={`meal-item-${index}`}>
      <View style={styles.row}>
        <TextInput value={item.name} onChangeText={(name) => onEdit({ name })} placeholder="Food" placeholderTextColor={colors.faint} style={[styles.itemName, errorFor('name') && styles.inputError]} accessibilityLabel={`Food ${index + 1} name`} />
        <Pressable onPress={onRemove} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
          <Text style={styles.removeText}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Field label="Amount" value={item.quantity} onChange={(quantity) => onEdit({ quantity })} error={!!errorFor('quantity')} a11y={`${label} amount`} />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Unit</Text>
          <TextInput value={item.unit} onChangeText={(unit) => onEdit({ unit })} placeholder="g" placeholderTextColor={colors.faint} autoCapitalize="none" style={styles.fieldInput} accessibilityLabel={`${label} unit`} />
        </View>
      </View>
      <View style={styles.row}>
        {nutrientKeys.map((k) => (
          <Field key={k} label={nutrientLabels[k].short} value={item[k]} onChange={(v) => onEdit({ [k]: v })} error={!!errorFor(k)} a11y={`${label} ${nutrientLabels[k].label.toLowerCase()} ${nutrientLabels[k].unit}`} />
        ))}
      </View>
      {mismatch !== null && <Text style={type.detail}>Check: its protein, carbs and fat add up to about {grouped(mismatch)} kJ, not {item.energyKj} kJ.</Text>}
    </View>
  );
}

function Field({ label, value, onChange, error, a11y }: { label: string; value: string; onChange: (v: string) => void; error: boolean; a11y: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={colors.faint} style={[styles.fieldInput, error && styles.inputError]} accessibilityLabel={a11y} />
    </View>
  );
}

function BottomBar({ m, onSave }: { m: M; onSave: () => void }) {
  const styles = useStyles();
  const d = m.draft!;
  const back = d.step !== 'capture' && !(d.mode === 'edit' && d.step === 'review') ? <View style={styles.backCell}><Button title="Back" variant="secondary" onPress={m.actions.back} /></View> : null;
  let primary: React.ReactNode = null;
  let extra: React.ReactNode = null;
  if (d.step === 'capture' && d.photos.length) primary = <Button title="Next" onPress={() => m.actions.goTo('photos')} />;
  if (d.step === 'photos') primary = <Button title="Next" onPress={() => m.actions.goTo('share')} disabled={!d.photos.length} />;
  if (d.step === 'share') {
    primary = <Button title="Share with AI" onPress={() => m.actions.share(0)} testID="meal-share" />;
    extra = <LinkButton title={d.shared || d.promptCopied ? 'I’ve got the reply → Next' : 'Skip to paste a reply →'} onPress={() => m.actions.goTo('paste')} testID="meal-to-paste" />;
  }
  if (d.step === 'paste') primary = <Button title="Check reply" onPress={m.actions.checkReply} disabled={!d.reply.trim()} testID="meal-check" />;
  if (d.step === 'review') {
    const title = d.mode === 'edit' ? 'Save changes' : 'Save meal';
    primary = <Button title={m.saving ? 'Saving…' : title} onPress={onSave} disabled={m.saving} testID="meal-save" />;
  }
  if (!primary && !back) return null;
  return (
    <View style={styles.footer} testID="meal-bar">
      <View style={styles.row}>
        {back}
        {primary && <View style={styles.flex}>{primary}</View>}
      </View>
      {extra}
    </View>
  );
}

function PhotoGrid({ photos, missing, onView, onRemove, large }: { photos: MealPhoto[]; missing: string[]; onView: (p: MealPhoto) => void; onRemove: (id: string) => void; large?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.grid} testID="meal-photos">
      {photos.map((p, i) => {
        const gone = missing.includes(p.id);
        const src = gone ? null : photoSource(p.uri);
        return (
          <View key={p.id} style={large ? styles.thumbLarge : styles.thumb}>
            <Pressable onPress={() => onView(p)} accessibilityRole="imagebutton" accessibilityLabel={gone ? `Photo ${i + 1} is missing` : `Photo ${i + 1}, view full screen`} testID={`meal-photo-${i}`}>
              {src ? <Image source={{ uri: src }} style={large ? styles.thumbLargeImage : styles.thumbImage} resizeMode="cover" /> : (
                <View style={[large ? styles.thumbLargeImage : styles.thumbImage, styles.missing]}><Text style={styles.missingText}>Photo missing</Text></View>
              )}
            </Pressable>
            <Pressable onPress={() => onRemove(p.id)} style={styles.thumbRemove} accessibilityRole="button" accessibilityLabel={`Delete photo ${i + 1}`} testID={`meal-photo-delete-${i}`}>
              <Text style={styles.thumbRemoveText}>✕</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function BigChoice({ icon, title, sub, onPress, testID }: { icon: string; title: string; sub: string; onPress: () => void; testID?: string }) {
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.big, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={title} testID={testID}>
      <View style={styles.bigIcon}><Text style={styles.bigIconText}>{icon}</Text></View>
      <View style={styles.flex}>
        <Text style={type.body}>{title}</Text>
        <Text style={type.detail}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function LinkButton({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.link} accessibilityRole="button" testID={testID}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: { marginTop: space.xxl },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm },
  pad: { paddingHorizontal: space.xl, paddingTop: space.md },
  gapTop: { marginTop: space.sm },
  strip: { flexDirection: 'row', gap: 6 },
  stripPart: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  stripOn: { backgroundColor: colors.accent },
  context: { marginTop: space.sm },
  content: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl, gap: space.md },
  stack: { gap: space.md },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  flex: { flex: 1 },
  notice: { borderRadius: radius.sm, backgroundColor: colors.accentSoft, padding: space.md },
  noticeText: { ...type.detail, color: colors.ink },
  big: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, minHeight: 80 },
  bigIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  bigIconText: { fontSize: 22 },
  pressed: { opacity: 0.75 },
  warn: { borderWidth: 1, borderColor: colors.sore, borderRadius: radius.sm, padding: space.md, gap: space.xs },
  warnText: { ...type.detail, color: colors.ink },
  warnStrong: { fontWeight: '800' },
  error: { borderWidth: 1, borderColor: colors.injured, borderRadius: radius.sm, padding: space.md, gap: space.xs },
  errorText: { ...type.detail, color: colors.ink },
  link: { minHeight: touch, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.sm },
  linkText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  hero: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.line },
  prompt: { ...type.detail, fontFamily: 'monospace', fontSize: 12, color: colors.ink, backgroundColor: colors.surface, padding: space.md, borderRadius: radius.sm },
  paste: { minHeight: 160, maxHeight: 280, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: space.md, fontSize: 14, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top' },
  nameInput: { minHeight: touch, fontSize: 20, fontWeight: '800', color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.line },
  inputError: { borderColor: colors.injured, borderBottomColor: colors.injured },
  chip: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', color: colors.sore, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.sore, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 4 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: space.sm, alignItems: 'center' },
  tileValue: { fontSize: 16, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 11, color: colors.muted },
  item: { gap: space.xs, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  itemName: { flex: 1, minHeight: touch, fontSize: 16, fontWeight: '700', color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.line },
  remove: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.muted, fontSize: 16 },
  field: { flex: 1, gap: 2 },
  fieldLabel: { fontSize: 11, color: colors.muted },
  fieldInput: { minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 6, fontSize: 15, color: colors.ink, backgroundColor: colors.surface, fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  backCell: { width: 104 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 72 },
  thumbImage: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.line },
  thumbLarge: { width: 150 },
  thumbLargeImage: { width: 150, height: 150, borderRadius: radius.sm, backgroundColor: colors.line },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 11, color: colors.muted, textAlign: 'center' },
  thumbRemove: { position: 'absolute', top: 0, right: 0, width: touch, height: touch, alignItems: 'flex-end', padding: 4 },
  thumbRemoveText: { width: 24, height: 24, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.ink, color: colors.bg, textAlign: 'center', lineHeight: 24, fontSize: 12 },
}));
