import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { EnergyDisplay } from '../../energy';
import { buildSetupPrompt, checkSetupReply, type SetupReply } from '../../onboarding/ai';
import { chooseWeightBand, enterExactWeight, isMinor, readDraft, toggleGoal, type Draft, type Goal, type Step } from '../../onboarding/draft';
import { finishSetup } from '../../onboarding/finish';
import {
  activityLabels,
  ageLabels,
  answerLines,
  dayOptions,
  genderLabels,
  goalLabels,
  minuteOptions,
  placeLabels,
  weightBandLabels,
} from '../../onboarding/labels';
import { buildStarterPlan } from '../../onboarding/starterPlan';
import { toLocalDate } from '../../plan/dates';
import { activityLevels, ageBands, fitnessGoals, genders, trainingPlaces, weightBands, type Plan } from '../../plan/schema';
import { preferences } from '../../platform/preferences';
import type { TrackingStore } from '../../storage/types';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { Card, Chip, Chips, Grid, Question, styles as ws, TextLink, WizardFrame } from './WizardParts';

type Props = { store: TrackingStore; energy: EnergyDisplay; onFinished: (plan: Plan) => void };

const DISCLAIMER = 'AI-generated suggestion, not medical advice.';

/**
 * First-run setup (#49, option A): About you → Goals → Practical context → Generate → Review, then Today.
 * Every answer is optional. Progress is saved on the device after each change, so setup resumes after a
 * restart. Nothing is stored as a plan until the user confirms on the review.
 */
export function SetupWizard({ store, energy, onFinished }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reply, setReply] = useState('');
  const [result, setResult] = useState<SetupReply | null>(null);
  const [copied, setCopied] = useState<'prompt' | 'details' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferences.setupDraft().then((json) => {
      if (cancelled) return;
      const d = readDraft(json);
      // A pasted reply isn't kept across restarts: an AI review resumes at Generate.
      setDraft(d.step === 'review' && d.path === 'ai' ? { ...d, step: 'generate', path: undefined } : d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useRef<(d: Draft) => void>(() => undefined);
  save.current = (d: Draft) => {
    setDraft(d);
    preferences.setSetupDraft(JSON.stringify(d)).catch(() => undefined); // still works for this session
  };
  const update = (fn: (d: Draft) => Draft) => draft && save.current(fn(draft));
  const go = (step: Step, extra: Partial<Draft> = {}) => update((d) => ({ ...d, ...extra, step }));

  const starter = useMemo(() => (draft ? buildStarterPlan(draft) : null), [draft]);

  if (!draft || !starter) {
    return (
      <View style={local.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  const minor = isMinor(draft);

  const confirm = async (raw: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const plan = await finishSetup(store, raw, draft, toLocalDate(new Date()));
      await preferences.clearSetupDraft().catch(() => undefined);
      onFinished(plan);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  if (draft.step === 'about') {
    return (
      <WizardFrame
        testID="setup-about"
        step={1}
        total={minor ? 2 : 4}
        title="About you"
        sub="All optional. It stays on this phone unless you choose to share it with an AI."
        onSkip={() => go(minor ? 'review' : 'goals', minor ? { path: 'basic' } : {})}
        primary={{ title: minor ? 'Continue' : 'Next', onPress: () => go(minor ? 'review' : 'goals', minor ? { path: 'basic' } : {}) }}
      >
        <Question label="Gender">
          <Grid>
            {genders.map((g) => (
              <Chip key={g} wide label={genderLabels[g]} selected={draft.gender === g} onPress={() => update((d) => ({ ...d, gender: d.gender === g ? undefined : g }))} testID={`gender-${g}`} />
            ))}
          </Grid>
        </Question>
        <Question label="Age">
          <Chips>
            {ageBands.map((a) => (
              <Chip key={a} label={ageLabels[a]} selected={draft.ageBand === a} onPress={() => update((d) => ({ ...d, ageBand: d.ageBand === a ? undefined : a }))} testID={`age-${a}`} />
            ))}
          </Chips>
          {minor ? (
            <View style={local.notice} testID="setup-minor" accessibilityLiveRegion="polite">
              <Text style={local.noticeTitle}>Personalised plans are for adults</Text>
              <Text style={local.noticeText}>AI fitness and diet plans in this app are for people 18 and over. You can still use the app to track your activity and measurements.</Text>
            </View>
          ) : null}
        </Question>
        <WeightQuestion draft={draft} update={update} />
      </WizardFrame>
    );
  }

  if (draft.step === 'goals') {
    const primary = draft.primaryGoal ?? draft.fitnessGoals[0];
    return (
      <WizardFrame
        testID="setup-goals"
        step={2}
        total={4}
        title="Your goals"
        sub="Pick any that apply. The primary goal leads the plan."
        onSkip={() => go('context')}
        onBack={() => go('about')}
        primary={{ title: 'Next', onPress: () => go('context') }}
      >
        <View style={ws.question} accessibilityLabel="Goals">
          {fitnessGoals.map((g) => (
            <GoalOption
              key={g}
              goal={g}
              selected={draft.fitnessGoals.includes(g)}
              primary={draft.fitnessGoals.includes(g) && primary === g}
              showPrimary={draft.fitnessGoals.length > 1}
              onToggle={() => update((d) => toggleGoal(d, g))}
              onMakePrimary={() => update((d) => ({ ...d, primaryGoal: g }))}
            />
          ))}
          {draft.fitnessGoals.length > 1 ? <Text style={ws.hint}>Tap “Make primary” to change which goal leads.</Text> : null}
        </View>
      </WizardFrame>
    );
  }

  if (draft.step === 'context') {
    return (
      <WizardFrame
        testID="setup-context"
        step={3}
        total={4}
        title="Practical context"
        sub="All optional. Skip anything you'd rather not say."
        onSkip={() => go('generate')}
        onBack={() => go('goals')}
        primary={{ title: 'Next', onPress: () => go('generate') }}
      >
        <Question label="Days per week">
          <Chips>
            {dayOptions.map((n) => (
              <Chip key={n} label={n === 6 ? '6+' : String(n)} selected={draft.daysPerWeek === n} onPress={() => update((d) => ({ ...d, daysPerWeek: d.daysPerWeek === n ? undefined : n }))} testID={`days-${n}`} />
            ))}
          </Chips>
        </Question>
        <Question label="Time per session">
          <Chips>
            {minuteOptions.map((n) => (
              <Chip key={n} label={n === 60 ? '60 min+' : `${n} min`} selected={draft.sessionMinutes === n} onPress={() => update((d) => ({ ...d, sessionMinutes: d.sessionMinutes === n ? undefined : n }))} testID={`minutes-${n}`} />
            ))}
          </Chips>
        </Question>
        <Question label="Where you train">
          <Chips>
            {trainingPlaces.map((p) => (
              <Chip
                key={p}
                multi
                label={placeLabels[p]}
                selected={draft.trainingPlaces.includes(p)}
                onPress={() => update((d) => ({ ...d, trainingPlaces: d.trainingPlaces.includes(p) ? d.trainingPlaces.filter((x) => x !== p) : [...d.trainingPlaces, p] }))}
                testID={`place-${p}`}
              />
            ))}
          </Chips>
        </Question>
        <Question label="Current activity">
          <Chips>
            {activityLevels.map((a) => (
              <Chip key={a} label={activityLabels[a]} selected={draft.activityLevel === a} onPress={() => update((d) => ({ ...d, activityLevel: d.activityLevel === a ? undefined : a }))} testID={`activity-${a}`} />
            ))}
          </Chips>
        </Question>
        <View style={ws.question}>
          <Text style={type.section}>Anything to work around</Text>
          <TextInput
            value={draft.considerations ?? ''}
            onChangeText={(t) => update((d) => ({ ...d, considerations: t.slice(0, 200) || undefined }))}
            placeholder="Injuries, limits, food restrictions…"
            placeholderTextColor={colors.faint}
            multiline
            style={local.textField}
            accessibilityLabel="Anything to work around"
            testID="setup-considerations"
          />
        </View>
      </WizardFrame>
    );
  }

  if (draft.step === 'generate') {
    const failed = result && !result.ok ? result : null;
    const copy = async (what: 'prompt' | 'details', text: string) => {
      await Clipboard.setStringAsync(text);
      setCopied(what);
    };
    const check = () => {
      const r = checkSetupReply(starter, reply, draft, energy);
      setResult(r);
      if (r.ok) go('review', { path: 'ai' });
    };
    return (
      <WizardFrame
        testID="setup-generate"
        step={4}
        total={4}
        title="Get a suggested plan"
        sub="Copy a prompt to any AI chat assistant, then paste its reply here."
        onBack={() => go('context')}
        primary={{ title: 'Check reply', onPress: check, disabled: !reply.trim() }}
      >
        <Card title="1 · Copy the prompt">
          <Text style={local.body} testID="setup-prompt-summary">
            {answerLines(draft).length
              ? `It includes what you told the app: ${answerLines(draft).map(summaryValue).join(', ')}. Nothing else.`
              : "You didn't share anything, so the AI will ask you. Nothing else is included."}
          </Text>
          <Pressable
            onPress={() => copy('prompt', buildSetupPrompt(starter, draft, toLocalDate(new Date())))}
            style={({ pressed }) => [local.outline, pressed && local.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Copy prompt"
            testID="setup-copy-prompt"
          >
            <Text style={local.outlineText}>{copied === 'prompt' ? 'Copied: paste it into any AI chat' : 'Copy prompt'}</Text>
          </Pressable>
        </Card>
        <Card title="2 · Paste the reply">
          <TextInput
            value={reply}
            onChangeText={(t) => {
              setReply(t);
              setResult(null);
            }}
            multiline
            placeholder="Paste the AI's whole reply here"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={local.replyField}
            accessibilityLabel="AI reply"
            testID="setup-reply"
          />
        </Card>
        {failed ? (
          <View style={local.errorPanel} testID="setup-errors" accessibilityLiveRegion="polite">
            <Text style={local.noticeTitle}>The app couldn't use this reply</Text>
            {failed.errors.slice(0, 5).map((e, i) => (
              <Text key={i} style={local.noticeText} selectable>
                {e}
              </Text>
            ))}
            {failed.diagnostics ? (
              <TextLink title={copied === 'details' ? 'Copied: paste it to the AI' : 'Copy details for the AI'} onPress={() => copy('details', failed.diagnostics!)} testID="setup-copy-details" />
            ) : null}
          </View>
        ) : null}
        <Text style={ws.hint}>The reply is an AI-generated suggestion, not medical advice. You'll review every value before anything is saved.</Text>
        <TextLink title="Skip for now: start with a basic profile" onPress={() => go('review', { path: 'basic' })} testID="setup-skip-ai" />
      </WizardFrame>
    );
  }

  // Review.
  const ai = draft.path === 'ai' && result?.ok ? result : null;
  const answers = answerLines(draft);
  const weighIn = draft.exactWeight !== undefined ? (draft.logWeighIn ? `${draft.exactWeight} ${draft.unit} logged as today's weigh-in` : 'Not logged as a weigh-in') : null;
  return (
    <WizardFrame
      testID="setup-review"
      step={minor ? 2 : 4}
      total={minor ? 2 : 4}
      title={ai ? 'Review the suggestion' : 'Review your profile'}
      sub={ai ? `${DISCLAIMER} Check each value; edit anything before you confirm.` : minor ? 'Tracking only. Nothing here is personalised.' : 'Weight tracking now. Set up a plan with AI any time.'}
      onBack={() => go(minor ? 'about' : 'generate', { path: undefined })}
      primary={{ title: saving ? 'Saving…' : ai ? 'Confirm and start' : 'Start tracking', onPress: () => confirm(ai ? ai.nextRaw : starter), disabled: saving }}
    >
      {ai ? (
        <Card title="Assumed by the AI" testID="review-ai">
          {ai.preview.flatMap((p) => p.lines.map((l, i) => <ReviewRow key={`${p.section}-${i}`} label={p.title} value={l.text} tag="Assumed" assumed />))}
          {ai.notes.map((n, i) => (
            <Text key={i} style={ws.hint}>
              {n}
            </Text>
          ))}
        </Card>
      ) : (
        <Card title="Your plan" testID="review-basic">
          <Text style={local.body}>{minor ? 'Weight tracking only.' : 'Weight tracking. No workouts yet.'}</Text>
        </Card>
      )}
      <Card title="From you" testID="review-from-you">
        {answers.length ? (
          answers.map((a) => <ReviewRow key={a.label} label={a.label} value={a.value} tag="From you" />)
        ) : (
          <Text style={local.body}>Nothing yet. That's fine.</Text>
        )}
        {weighIn ? <Text style={ws.hint} testID="review-weigh-in">{weighIn}</Text> : null}
      </Card>
      <Card title="Nutrition" testID="review-nutrition">
        <Text style={local.body}>Not set up yet.</Text>
      </Card>
      {saveError ? (
        <Text style={local.noticeText} accessibilityLiveRegion="polite">
          {`Couldn't save: ${saveError}`}
        </Text>
      ) : null}
      <View style={local.links}>
        <TextLink title="Edit answers" onPress={() => go('about', { path: undefined })} testID="review-edit" />
        {ai ? (
          <TextLink
            title="Ask the AI again"
            onPress={() => {
              setReply('');
              setResult(null);
              go('generate', { path: undefined });
            }}
            testID="review-regenerate"
          />
        ) : null}
      </View>
    </WizardFrame>
  );
}

/** One answer as it reads inside a sentence ("3 days a week", not a bare "3"). */
function summaryValue(a: { label: string; value: string }): string {
  if (a.label === 'Days per week') return `${a.value} days a week`;
  if (a.label === 'Time per session') return `${a.value} per session`;
  if (a.label === 'To work around') return `to work around: ${a.value}`;
  return a.value;
}

function WeightQuestion({ draft, update }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void }) {
  const [exact, setExact] = useState(draft.exactWeight !== undefined);
  const [text, setText] = useState(draft.exactWeight !== undefined ? String(draft.exactWeight) : '');
  return (
    <View style={ws.question} testID="setup-weight">
      <View style={local.weightHeader}>
        <Text style={type.section}>Weight</Text>
        <View style={local.units} accessibilityRole="radiogroup" accessibilityLabel="Weight unit">
          {(['kg', 'lb'] as const).map((u) => (
            <Chip key={u} label={u} selected={draft.unit === u} onPress={() => update((d) => ({ ...d, unit: u }))} testID={`unit-${u}`} />
          ))}
        </View>
      </View>
      {exact ? (
        <View style={ws.question}>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              const n = Number(t.replace(',', '.'));
              update((d) => enterExactWeight(d, t.trim() && Number.isFinite(n) && n > 0 && n <= 1500 ? Math.round(n * 10) / 10 : undefined));
            }}
            keyboardType="decimal-pad"
            placeholder={`Weight in ${draft.unit}`}
            placeholderTextColor={colors.faint}
            style={local.weightField}
            accessibilityLabel={`Exact weight in ${draft.unit}`}
            testID="setup-exact-weight"
          />
          <Pressable
            onPress={() => update((d) => ({ ...d, logWeighIn: d.exactWeight !== undefined && !d.logWeighIn }))}
            disabled={draft.exactWeight === undefined}
            style={local.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.logWeighIn, disabled: draft.exactWeight === undefined }}
            aria-checked={draft.logWeighIn}
            accessibilityLabel="Also log this as today's weigh-in"
            testID="setup-log-weigh-in"
          >
            <View style={[local.box, draft.logWeighIn && local.boxOn]}>{draft.logWeighIn ? <Text style={local.tick}>✓</Text> : null}</View>
            <Text style={local.body}>Also log this as today's weigh-in</Text>
          </Pressable>
          <TextLink
            title="Choose a range instead"
            onPress={() => {
              setExact(false);
              setText('');
              update((d) => enterExactWeight(d, undefined));
            }}
            testID="setup-weight-range"
          />
        </View>
      ) : (
        <>
          <Chips>
            {weightBands.map((b) => (
              <Chip key={b} label={weightBandLabels[b][draft.unit]} selected={draft.weightBand === b} onPress={() => update((d) => chooseWeightBand(d, d.weightBand === b ? undefined : b))} testID={`weight-${b}`} />
            ))}
          </Chips>
          <TextLink title="Enter exact weight instead" onPress={() => setExact(true)} testID="setup-weight-exact" />
          <Text style={ws.hint}>A range is only a guide for the plan. It's never recorded as a weigh-in.</Text>
        </>
      )}
    </View>
  );
}

function GoalOption(props: { goal: Goal; selected: boolean; primary: boolean; showPrimary: boolean; onToggle: () => void; onMakePrimary: () => void }) {
  const { goal, selected, primary, showPrimary, onToggle, onMakePrimary } = props;
  const g = goalLabels[goal];
  return (
    <View style={[local.option, selected && local.optionOn]} testID={`goal-${goal}`}>
      <Pressable
        onPress={onToggle}
        style={local.optionMain}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        aria-checked={selected}
        accessibilityLabel={g.label}
        accessibilityHint={g.detail}
      >
        <View style={[local.box, selected && local.boxOn]}>{selected ? <Text style={local.tick}>✓</Text> : null}</View>
        <View style={local.optionText}>
          <Text style={local.optionTitle}>{g.label}</Text>
          <Text style={local.optionDetail}>{g.detail}</Text>
        </View>
      </Pressable>
      {selected && showPrimary ? (
        primary ? (
          <Text style={local.primaryTag} testID={`goal-${goal}-primary`}>
            Primary
          </Text>
        ) : (
          <Pressable onPress={onMakePrimary} style={local.makePrimary} accessibilityRole="button" accessibilityLabel={`Make ${g.label} primary`}>
            <Text style={local.makePrimaryText}>Make primary</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function ReviewRow({ label, value, tag, assumed }: { label: string; value: string; tag: string; assumed?: boolean }) {
  return (
    <View style={local.reviewRow}>
      <View style={local.reviewText}>
        <Text style={local.reviewLabel}>{label}</Text>
        <Text style={local.reviewValue}>{value}</Text>
      </View>
      <Text style={[local.tag, assumed ? local.tagAssumed : local.tagYou]}>{tag}</Text>
    </View>
  );
}

const local = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21, flexShrink: 1 },
  pressed: { opacity: 0.75 },
  notice: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.accent, padding: space.md, gap: space.xs },
  noticeTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  noticeText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  errorPanel: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.ink, padding: space.lg, gap: space.sm },
  textField: { minHeight: touch, maxHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
  replyField: { minHeight: 110, maxHeight: 220, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bg, padding: space.md, fontSize: 13, color: colors.ink, fontFamily: 'monospace', textAlignVertical: 'top' },
  outline: { minHeight: touch, borderRadius: radius.md, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  outlineText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  weightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  units: { flexDirection: 'row', gap: space.xs },
  weightField: { minHeight: touch, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md, fontSize: 18, color: colors.ink },
  checkRow: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.md },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  option: { minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingRight: space.md },
  optionOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionMain: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  optionDetail: { fontSize: 14, color: colors.muted },
  primaryTag: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.onAccent, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xs, overflow: 'hidden' },
  makePrimary: { minHeight: touch, justifyContent: 'center' },
  makePrimaryText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg },
  reviewRow: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: space.xs },
  reviewText: { flex: 1, gap: 2 },
  reviewLabel: { fontSize: 13, color: colors.muted },
  reviewValue: { fontSize: 15, fontWeight: '600', color: colors.ink },
  tag: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3, overflow: 'hidden' },
  tagYou: { backgroundColor: colors.accentSoft, color: colors.accent },
  tagAssumed: { backgroundColor: colors.line, color: colors.ink },
});

