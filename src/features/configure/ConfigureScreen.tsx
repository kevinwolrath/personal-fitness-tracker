import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ChangeLine, SectionPreview } from '../../config/diff';
import { sections as sectionDefs } from '../../config/sections';
import { summarizeConfig } from '../../config/summary';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { useConfigSession } from './useConfigSession';

const mark: Record<ChangeLine['kind'], string> = { add: '+', remove: '−', change: '~' };
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * "AI is the configuration editor; the app is the configuration owner" (contract 07).
 * One page (contract 02 "Configure"): finished steps collapse to a line, the preview lists only the
 * sections that change, and there is one primary action at a time. Apply lives in a fixed bottom bar.
 */
export function ConfigureScreen() {
  const { store, reloadPlan, energy } = useApp();
  const s = useConfigSession(store, reloadPlan, energy);
  const [copied, setCopied] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  // A new check result means new details: the copy button starts over.
  useEffect(() => setDiagnosticsCopied(false), [s.check]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!s.raw) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.muted} />
      </SafeAreaView>
    );
  }

  const previewing = s.check.kind === 'preview';
  const hasText = s.text.trim() !== '';
  const copyDone = copied || hasText;
  const latest = s.history[0];
  const canUndo = latest && latest.toRevision === s.stored?.revision;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        {/* A pasted update is lost on close: Cancel. Otherwise nothing is: Close. */}
        <ModalHeader title="Configure with AI" dismiss={{ label: hasText ? 'Cancel' : 'Close', onPress: close }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="configure-scroll">
        {!copyDone && (
          <Text style={type.detail}>
            Change your plan by talking it through with ChatGPT or Claude. The app checks every change and shows it to you before
            anything is saved.
          </Text>
        )}

        {/* Step 1: copy the instructions. */}
        {copyDone ? (
          <DoneRow
            label={copied ? 'Instructions copied' : 'AI instructions'}
            action="Copy again"
            actionLabel="Copy AI instructions"
            onPress={async () => setCopied(await s.copyInstructions())}
          />
        ) : (
          <View style={styles.step}>
            <Text style={type.section}>1 · Copy instructions</Text>
            <Text style={type.detail}>Paste them into a new chat. They include your current setup and the exact format the app accepts.</Text>
            <Button title="Copy AI instructions" onPress={async () => setCopied(await s.copyInstructions())} accessibilityLabel="Copy AI instructions" />
          </View>
        )}

        {/* Step 2: paste and check the AI's update. */}
        {previewing ? (
          <DoneRow label="Update checked" action="Change" actionLabel="Change update" onPress={() => s.editText(s.text)} />
        ) : (
          <View style={styles.step}>
            <Text style={type.section}>2 · Paste the AI's update</Text>
            <TextInput
              value={s.text}
              onChangeText={s.editText}
              multiline
              placeholder={'{ "fitnessConfigUpdate": { … } }'}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="AI update"
              testID="config-input"
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button title="Paste" variant="secondary" onPress={s.pasteFromClipboard} />
              </View>
              <View style={styles.flex}>
                {/* Primary only once step 1 is done: one primary action at a time. */}
                <Button title="Check update" variant={copyDone ? 'primary' : 'secondary'} onPress={s.runCheck} disabled={!hasText} />
              </View>
            </View>
          </View>
        )}

        {s.check.kind === 'invalid' && (
          <View style={[styles.panel, styles.errorPanel]} testID="config-errors" accessibilityLiveRegion="polite">
            <Text style={type.body}>This update can't be used</Text>
            <Text style={type.detail}>Nothing was changed. Send these errors back to the AI and ask for a corrected update.</Text>
            {s.check.errors.map((e, i) => (
              <Text key={i} style={styles.errorText} selectable>
                • {e}
              </Text>
            ))}
            {s.check.recoverable.length > 0 && (
              <Text style={type.detail} testID="config-recoverable">
                Complete in what you pasted, not applied: {s.check.recoverable.join('; ')}.
              </Text>
            )}
            <Button
              title={diagnosticsCopied ? 'Copied: paste it to the AI' : 'Copy details for the AI'}
              variant="secondary"
              onPress={async () => {
                await s.copyDiagnostics();
                setDiagnosticsCopied(true);
              }}
            />
          </View>
        )}

        {s.check.kind === 'preview' && <Preview sections={s.check.sections} notes={s.check.notes} />}

        {!previewing && latest && (
          <View style={styles.panel} testID="config-history">
            <Text style={type.section}>Last change</Text>
            <Text style={type.detail}>
              {latest.sections.includes('undo') ? 'Undo' : latest.sections.map((x) => sectionDefs[x as keyof typeof sectionDefs]?.title ?? x).join(', ')} ·{' '}
              {new Date(latest.appliedAt).toLocaleString()} · revision {latest.toRevision}
            </Text>
            {canUndo && <Button title="Undo last change" variant="secondary" onPress={s.undoLatest} disabled={s.busy} />}
          </View>
        )}

        {!previewing && (
          <View style={styles.step}>
            <Text style={type.section}>Your configuration</Text>
            {summarizeConfig(s.raw, energy).map((sec) => (
              <View key={sec.section} style={styles.summarySection} testID={`summary-${sec.section}`}>
                <Text style={styles.sectionTitle}>{sec.title}</Text>
                {sec.lines.map((l, i) => (
                  <Text key={i} style={type.detail}>
                    {l}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {s.check.kind === 'preview' && (
        <View style={styles.bar} testID="config-actions">
          <View>
            <Button title="Discard" variant="secondary" onPress={() => s.editText('')} />
          </View>
          <View style={styles.flex}>
            <Button
              title={s.check.changeCount ? `Apply ${s.check.changeCount} change${s.check.changeCount > 1 ? 's' : ''}` : 'Nothing to apply'}
              onPress={s.apply}
              disabled={!s.check.changeCount || s.busy}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/** A finished step, collapsed to one line with a way back in. */
function DoneRow(p: { label: string; action: string; actionLabel: string; onPress: () => void }) {
  return (
    <View style={styles.doneRow}>
      <View style={styles.tick}>
        <Text style={styles.tickText}>✓</Text>
      </View>
      <Text style={[type.body, styles.flex]} numberOfLines={1}>
        {p.label}
      </Text>
      <Pressable onPress={p.onPress} style={styles.doneAction} accessibilityRole="button" accessibilityLabel={p.actionLabel}>
        <Text style={styles.link}>{p.action}</Text>
      </Pressable>
    </View>
  );
}

/** Only the sections that change, one row each; open a row to see every change in it. */
function Preview({ sections, notes }: { sections: SectionPreview[]; notes: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showFixes, setShowFixes] = useState(false);
  const changing = sections.filter((s) => s.supplied && s.lines.length);
  const unchanged = sections.filter((s) => !s.supplied || !s.lines.length).map((s) => s.title.toLowerCase());
  return (
    <View style={styles.step} testID="config-preview" accessibilityLiveRegion="polite">
      <Text style={type.section} accessibilityRole="header">
        What changes
      </Text>
      {notes.length > 0 && (
        <View testID="config-fixes">
          {/* Option A (#47): one quiet line; what was repaired is one tap away, never in the way. */}
          <View style={styles.fixesRow}>
            <Text style={[type.detail, styles.flex]}>
              Fixed automatically: {notes.length} formatting problem{notes.length > 1 ? 's' : ''} in what the AI sent.
            </Text>
            <Pressable onPress={() => setShowFixes(!showFixes)} style={styles.fixesToggle} accessibilityRole="button" aria-expanded={showFixes}>
              <Text style={styles.fixesToggleText}>{showFixes ? 'Hide' : 'Details'}</Text>
            </Pressable>
          </View>
          {showFixes &&
            notes.map((n, i) => (
              <Text key={i} style={[type.detail, styles.fixLine]} selectable>
                • {n}
              </Text>
            ))}
        </View>
      )}
      {changing.length ? (
        <View style={styles.list}>
          {changing.map((sec, i) => {
            const expanded = open === sec.section;
            const more = sec.lines.length - 1;
            return (
              <View key={sec.section} style={[styles.item, i > 0 && styles.itemDivider]} testID={`preview-${sec.section}`}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : sec.section)}
                  style={styles.itemHead}
                  accessibilityRole="button"
                  aria-expanded={expanded}
                  accessibilityLabel={`${sec.title}: ${sec.lines.length} change${sec.lines.length > 1 ? 's' : ''}`}
                >
                  <View style={styles.flex}>
                    <Text style={styles.sectionTitle}>{sec.title}</Text>
                    {!expanded && (
                      <Text style={type.detail} numberOfLines={2}>
                        {sec.lines[0].text}
                        {more > 0 ? `, and ${more} more` : ''}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
                </Pressable>
                {expanded &&
                  sec.lines.map((l, j) => (
                    <Text key={j} style={[styles.line, l.kind === 'remove' && styles.lineRemove]}>
                      <Text style={styles.mark}>{mark[l.kind]} </Text>
                      {l.text}
                    </Text>
                  ))}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={type.body}>This update doesn't change anything.</Text>
      )}
      {changing.length > 0 && unchanged.length > 0 && (
        <Text style={type.detail} testID="preview-unchanged">
          {listWords(unchanged).replace(/^./, (c) => c.toUpperCase())} stay as they are.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: space.lg },
  link: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.lg },
  step: { gap: space.sm },
  input: {
    minHeight: 140,
    maxHeight: 280,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: space.md,
    fontSize: 13,
    color: colors.ink,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch + 8,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tick: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  tickText: { color: colors.onAccent, fontSize: 12, fontWeight: '800' },
  doneAction: { minHeight: touch, minWidth: touch, paddingHorizontal: space.sm, justifyContent: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  errorPanel: { borderWidth: 2, borderColor: colors.ink },
  errorText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  fixesRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
  fixesToggle: { minHeight: touch, justifyContent: 'center' },
  fixesToggleText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  fixLine: { marginBottom: space.xs },
  list: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  item: { paddingHorizontal: space.lg, paddingBottom: space.xs, gap: 4 },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 16, paddingVertical: space.sm },
  chevron: { fontSize: 18, color: colors.muted, width: 20, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  line: { fontSize: 15, color: colors.ink, lineHeight: 21, paddingBottom: 4 },
  lineRemove: { color: colors.muted },
  mark: { fontWeight: '900', color: colors.accent },
  summarySection: { gap: 2, paddingVertical: space.xs },
  bar: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
});
