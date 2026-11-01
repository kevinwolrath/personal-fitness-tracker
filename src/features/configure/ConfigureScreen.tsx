import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ChangeLine } from '../../config/diff';
import { sections as sectionDefs } from '../../config/sections';
import { summarizeConfig } from '../../config/summary';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { useConfigSession } from './useConfigSession';

const mark: Record<ChangeLine['kind'], string> = { add: '+', remove: '−', change: '~' };

/**
 * "AI is the configuration editor; the app is the configuration owner" (contract 07).
 * No settings controls: copy instructions → talk to any chat AI → paste its update → preview → apply.
 */
export function ConfigureScreen() {
  const { store, reloadPlan } = useApp();
  const s = useConfigSession(store, reloadPlan);
  const [copied, setCopied] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!s.raw) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.muted} />
      </SafeAreaView>
    );
  }

  const latest = s.history[0];
  const canUndo = latest && latest.toRevision === s.stored?.revision;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.link}>Close</Text>
        </Pressable>
        <Text style={[type.body, styles.headerTitle]} accessibilityRole="header">
          Configure with AI
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="configure-scroll">
        <Text style={type.detail}>
          Change your plan by talking it through with ChatGPT or Claude. The app checks every change and shows it to you before
          anything is saved.
        </Text>

        <View style={styles.step}>
          <Text style={type.section}>1 · Copy instructions</Text>
          <Text style={type.detail}>Paste them into a new chat. They include your current setup and the exact format the app accepts.</Text>
          <Button
            title={copied ? 'Copied ✓' : 'Copy AI instructions'}
            onPress={async () => setCopied(await s.copyInstructions())}
            accessibilityLabel="Copy AI instructions"
          />
        </View>

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
              <Button title="Check update" onPress={s.runCheck} disabled={!s.text.trim()} />
            </View>
          </View>
        </View>

        {s.check.kind === 'invalid' && (
          <View style={[styles.panel, styles.errorPanel]} testID="config-errors" accessibilityLiveRegion="polite">
            <Text style={type.body}>This update can't be used</Text>
            <Text style={type.detail}>Nothing was changed. Send these errors back to the AI and ask for a corrected update.</Text>
            {s.check.errors.map((e, i) => (
              <Text key={i} style={styles.errorText} selectable>
                • {e}
              </Text>
            ))}
          </View>
        )}

        {s.check.kind === 'preview' && (
          <View style={styles.panel} testID="config-preview" accessibilityLiveRegion="polite">
            <Text style={type.body} accessibilityRole="header">
              Configuration update detected
            </Text>
            {s.check.sections.map((sec) => (
              <View key={sec.section} style={styles.previewSection} testID={`preview-${sec.section}`}>
                <Text style={[styles.previewTitle, !sec.supplied && styles.muted]}>{sec.title}</Text>
                {!sec.supplied ? (
                  <Text style={[type.detail, styles.muted]}>Not in this update · unchanged</Text>
                ) : sec.lines.length === 0 ? (
                  <Text style={type.detail}>No changes</Text>
                ) : (
                  sec.lines.map((l, i) => (
                    <Text key={i} style={[styles.line, l.kind === 'remove' && styles.lineRemove]}>
                      <Text style={styles.mark}>{mark[l.kind]} </Text>
                      {l.text}
                    </Text>
                  ))
                )}
              </View>
            ))}
            <View style={styles.actions}>
              <Button
                title={s.check.changeCount ? 'Apply update' : 'Nothing to apply'}
                onPress={s.apply}
                disabled={!s.check.changeCount || s.busy}
              />
              <Button title="Discard" variant="quiet" onPress={() => s.editText('')} />
            </View>
          </View>
        )}

        {latest && (
          <View style={styles.panel} testID="config-history">
            <Text style={type.section}>Last change</Text>
            <Text style={type.detail}>
              {latest.sections.includes('undo') ? 'Undo' : latest.sections.map((x) => sectionDefs[x as keyof typeof sectionDefs]?.title ?? x).join(', ')} ·{' '}
              {new Date(latest.appliedAt).toLocaleString()} · revision {latest.toRevision}
            </Text>
            {canUndo && <Button title="Undo last change" variant="secondary" onPress={s.undoLatest} disabled={s.busy} />}
          </View>
        )}

        <View style={styles.step}>
          <Text style={type.section}>Your configuration</Text>
          {summarizeConfig(s.raw).map((sec) => (
            <View key={sec.section} style={styles.summarySection} testID={`summary-${sec.section}`}>
              <Text style={styles.previewTitle}>{sec.title}</Text>
              {sec.lines.map((l, i) => (
                <Text key={i} style={type.detail}>
                  {l}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: touch + 8 },
  headerButton: { minWidth: 72, minHeight: touch, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  link: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.xl },
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
  panel: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  errorPanel: { borderWidth: 2, borderColor: colors.ink },
  errorText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  previewSection: { gap: 2, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  previewTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  muted: { color: colors.faint },
  line: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  lineRemove: { color: colors.muted },
  mark: { fontWeight: '900', color: colors.accent },
  actions: { gap: space.xs, marginTop: space.sm },
  summarySection: { gap: 2, paddingVertical: space.xs },
});
