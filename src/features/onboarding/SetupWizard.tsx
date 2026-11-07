import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RawPlan } from '../../config/sections';
import type { EnergyDisplay } from '../../energy';
import { buildSetupPrompt, checkSetupReply, type SetupReply } from '../../onboarding/ai';
import {
  chooseAgeBand,
  chooseWeightBand,
  enterAge,
  enterExactWeight,
  isMinor,
  readDraft,
  resetChoices,
  toggleGoal,
  toggleIn,
  type Draft,
  type Goal,
  type Step,
} from '../../onboarding/draft';
import { applyProfileToExisting, applySetupToExisting, finishSetup } from '../../onboarding/finish';
import {
  activityLabels,
  adultAgeBands,
  ageLabels,
  answerLines,
  cmToIn,
  dayOptions,
  dietLabels,
  equipmentLabels,
  genderLabels,
  goalLabels,
  inToCm,
  limitLabels,
  slotLabels,
  weightBandLabels,
} from '../../onboarding/labels';
import { activeNutritionSeed } from '../../onboarding/nutritionSeed';
import { buildStarterPlan, rebuildSummary, replanExisting } from '../../onboarding/starterPlan';
import { toLocalDate } from '../../plan/dates';
import { activityLevels, dietaryNeeds, equipmentKinds, fitnessGoals, genders, physicalLimits, weekdays, weightBands, type Plan } from '../../plan/schema';
import { preferences } from '../../platform/preferences';
import { exerciseStyles } from '../../presets/exercisePlan';
import { plannedSlots, type MealSlot } from '../../presets/meals';
import type { StoredPlan, TrackingStore } from '../../storage/types';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { Card, Chip, Chips, Grid, Question, useWizardStyles, TextLink, WizardFrame } from './WizardParts';

type Props = {
  store: TrackingStore;
  energy: EnergyDisplay;
  onFinished: (plan: Plan) => void;
  /** Edit setup answers (#53): starts from the current plan's answers and replaces it only after confirmation. */
  edit?: { current: StoredPlan; initial: Draft; onCancel: () => void };
};

const dayNames: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const daysOf = (a: Record<string, any>) => (a.appliesTo?.days as string[] | undefined)?.slice().sort((x, y) => weekdays.indexOf(x as never) - weekdays.indexOf(y as never)) ?? [];

/**
 * Setup (#49, #53): About you → Goals → Your starter plan (Exercise | Meals). Every answer is optional.
 * Adults get an offline starter plan from the bundled presets; refining it with AI is optional. Under 18:
 * tracking only. First-run progress is saved on the device after each change; nothing becomes a plan until the
 * user starts with it (or, editing, confirms the replacement).
 */
export function SetupWizard({ store, energy, onFinished, edit }: Props) {
  const { colors, type } = useTheme();
  const local = useLocal();
  const ws = useWizardStyles();

  const [draft, setDraft] = useState<Draft | null>(edit ? edit.initial : null);
  const [tab, setTab] = useState<'exercise' | 'meals'>('exercise');
  const [swapSlot, setSwapSlot] = useState<MealSlot | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [check, setCheck] = useState<SetupReply | null>(null);
  const [aiPlan, setAiPlan] = useState<Extract<SetupReply, { ok: true }> | null>(null);
  const [copied, setCopied] = useState<'prompt' | 'details' | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Editing: rebuild the starter plan instead of saving the profile only (#53). */
  const [rebuild, setRebuild] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (edit) return;
    let cancelled = false;
    preferences.setupDraft().then((json) => !cancelled && setDraft(readDraft(json)));
    return () => {
      cancelled = true;
    };
  }, [edit]);

  const save = useRef<(d: Draft) => void>(() => undefined);
  save.current = (d: Draft) => {
    setDraft(d);
    if (!edit) preferences.setSetupDraft(JSON.stringify(d)).catch(() => undefined); // still works for this session
  };
  const update = (fn: (d: Draft) => Draft) => draft && save.current(fn(draft));
  const go = (step: Step) => update((d) => ({ ...d, step }));
  /** An answer that shapes the plan changed: any AI version no longer matches it. */
  const answer = (fn: (d: Draft) => Draft) => {
    setAiPlan(null);
    update(fn);
  };

  const starter = useMemo(() => (draft ? buildStarterPlan(draft) : null), [draft]);
  const everything = useMemo(() => (draft ? buildStarterPlan({ ...draft, removed: [] }) : null), [draft]);

  if (!draft || !starter || !everything) {
    return (
      <View style={local.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  const minor = isMinor(draft);
  const total = minor ? 2 : 3;
  const planToSave: RawPlan = aiPlan?.nextRaw ?? starter;

  const finish = async () => {
    setConfirming(false);
    setSaving(true);
    setSaveError(null);
    try {
      const today = toLocalDate(new Date());
      const plan = edit
        ? rebuild
          ? await applySetupToExisting(store, edit.current, planToSave, draft, today)
          : await applyProfileToExisting(store, edit.current, draft, today)
        : await finishSetup(store, planToSave, draft, today);
      if (!edit) await preferences.clearSetupDraft().catch(() => undefined);
      onFinished(plan);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  // ---- Step 1: About you ------------------------------------------------------------------
  if (draft.step === 'about') {
    const next = () => go(minor ? 'review' : 'goals');
    return (
      <WizardFrame
        testID="setup-about"
        step={1}
        total={total}
        title="About you"
        sub="All optional. Ranges are fine. It stays on this phone unless you share it with an AI."
        onSkip={next}
        onBack={edit?.onCancel}
        backLabel={edit ? 'Cancel' : 'Back'}
        primary={{ title: 'Next', onPress: next }}
      >
        <Question label="Gender">
          <Grid>
            {genders.map((g) => (
              <Chip key={g} wide label={genderLabels[g]} selected={draft.gender === g} onPress={() => update((d) => ({ ...d, gender: d.gender === g ? undefined : g }))} testID={`gender-${g}`} />
            ))}
          </Grid>
          <Text style={ws.hint}>“Other” includes non-binary. Gender never changes your plan: it's based on your goals, activity and measurements.</Text>
        </Question>
        <AgeQuestion draft={draft} update={answer} />
        <WeightQuestion draft={draft} update={update} />
        <HeightQuestion draft={draft} update={update} />
      </WizardFrame>
    );
  }

  // ---- Step 2: Goals ------------------------------------------------------------------------
  if (draft.step === 'goals') {
    return (
      <WizardFrame
        testID="setup-goals"
        step={2}
        total={3}
        title="Goals"
        sub="Pick any that fit. Gradual and faster loss are either/or."
        onSkip={() => go('review')}
        onBack={() => go('about')}
        primary={{ title: edit ? 'Review changes' : 'See my plan', onPress: () => go('review') }}
      >
        <View style={ws.question} accessibilityLabel="Goals">
          {fitnessGoals.map((g) => (
            <GoalOption key={g} goal={g} selected={draft.fitnessGoals.includes(g)} onToggle={() => answer((d) => toggleGoal(d, g))} />
          ))}
        </View>
        <Question label="Activity now">
          <Chips>
            {activityLevels.map((a) => (
              <Chip key={a} label={activityLabels[a]} selected={draft.activityLevel === a} onPress={() => answer((d) => resetChoices({ ...d, activityLevel: d.activityLevel === a ? undefined : a }))} testID={`activity-${a}`} />
            ))}
          </Chips>
        </Question>
        <Question label="Days per week, at most">
          <Chips>
            {dayOptions.map((n) => (
              <Chip key={n} label={String(n)} selected={draft.daysPerWeek === n} onPress={() => answer((d) => resetChoices({ ...d, daysPerWeek: d.daysPerWeek === n ? undefined : n }))} testID={`days-${n}`} />
            ))}
          </Chips>
        </Question>
        <Question label="Equipment">
          <Chips>
            {equipmentKinds.map((e) => (
              <Chip
                key={e}
                multi
                label={equipmentLabels[e]}
                selected={draft.equipment.includes(e)}
                onPress={() =>
                  answer((d) => {
                    // "None" and having equipment exclude each other.
                    const cleared = { ...d, equipment: e === 'none' ? d.equipment.filter((x) => x === 'none') : d.equipment.filter((x) => x !== 'none') };
                    return toggleIn(cleared, 'equipment', e);
                  })
                }
                testID={`equipment-${e}`}
              />
            ))}
          </Chips>
        </Question>
        <Question label="Go easy on">
          <Chips>
            {physicalLimits.map((l) => (
              <Chip key={l} multi label={limitLabels[l]} selected={draft.physicalLimits.includes(l)} onPress={() => answer((d) => toggleIn(d, 'physicalLimits', l))} testID={`limit-${l}`} />
            ))}
          </Chips>
        </Question>
        <Question label="Dietary needs and allergies">
          <Chips>
            {dietaryNeeds.map((n) => (
              <Chip key={n} multi label={dietLabels[n]} selected={draft.dietary.includes(n)} onPress={() => answer((d) => toggleIn(d, 'dietary', n))} testID={`diet-${n}`} />
            ))}
          </Chips>
        </Question>
        <View style={ws.question}>
          <Text style={type.section}>Anything else to work around</Text>
          <TextInput
            value={draft.considerations ?? ''}
            onChangeText={(t) => update((d) => ({ ...d, considerations: t.slice(0, 200) || undefined }))}
            placeholder="Injuries, other allergies, time limits…"
            placeholderTextColor={colors.faint}
            multiline
            style={local.textField}
            accessibilityLabel="Anything else to work around"
            testID="setup-considerations"
          />
        </View>
      </WizardFrame>
    );
  }

  // ---- Step 3: review ----------------------------------------------------------------------
  const startTitle = saving ? 'Saving…' : edit ? 'Replace my plan' : minor ? 'Start tracking' : 'Start with this plan';
  const start = () => (edit ? setConfirming(true) : finish());
  const confirmDialog = (
    <ConfirmDialog
      visible={confirming}
      title="Replace your current plan?"
      message="Your schedule, exercise settings and setup answers change. Your measurements, workout history, imports and earlier plan versions stay, and you can undo this from Configure with AI."
      confirmLabel="Replace plan"
      onCancel={() => setConfirming(false)}
      onConfirm={finish}
    />
  );

  // Editing an existing plan: save the answers only, unless the user explicitly asks to rebuild (#53).
  if (edit && !rebuild) {
    const answers = answerLines(draft);
    return (
      <WizardFrame
        testID="setup-edit-profile"
        step={total}
        total={total}
        title="Save your answers"
        sub="Only your profile changes. Your schedule, day types, meals, activities and targets stay exactly as they are."
        onBack={() => go(minor ? 'about' : 'goals')}
        primary={{ title: saving ? 'Saving…' : 'Save profile', onPress: finish, disabled: saving }}
      >
        <Card title="Your answers" testID="edit-answers">
          {answers.length ? answers.map((a) => <Row key={a.label} title={a.value} sub={a.label} />) : <Text style={local.body}>No answers. That's fine.</Text>}
        </Card>
        {draft.exactWeight !== undefined ? <Text style={ws.hint}>{draft.logWeighIn ? `${draft.exactWeight} ${draft.unit} will be logged as today's weigh-in.` : 'Your weight is not logged as a weigh-in.'}</Text> : null}
        {minor ? null : (
          <Card title="Rebuild starter plan instead" testID="edit-rebuild">
            <Text style={local.body}>Replace your schedule with a new starter plan from these answers. You'll see what changes, and confirm, before anything is replaced.</Text>
            <TextLink title="Preview a new starter plan" onPress={() => setRebuild(true)} testID="edit-preview-rebuild" />
          </Card>
        )}
        {saveError ? <Text style={local.error}>{`Couldn't save: ${saveError}`}</Text> : null}
      </WizardFrame>
    );
  }

  if (minor) {
    return (
      <WizardFrame testID="setup-review" step={2} total={2} title="Tracking only" sub="Personalised plans are for adults (18+). You can track your weight and anything you do." onBack={() => go('about')} primary={{ title: startTitle, onPress: start, disabled: saving }}>
        <Card title="Your app" testID="review-basic">
          <Text style={local.body}>Weight tracking only. No exercise or meal plan.</Text>
        </Card>
        {saveError ? <Text style={local.error}>{`Couldn't save: ${saveError}`}</Text> : null}
        {confirmDialog}
      </WizardFrame>
    );
  }

  // Swap one meal (inline: no nested modal).
  if (swapSlot) {
    const safe = activeNutritionSeed().mealOptions(draft.dietary)[swapSlot];
    const current = starter.activities.find((a: { id: string }) => a.id === swapSlot);
    const choose = (id: string | null) => {
      update((d) => ({ ...d, mealSwaps: { ...d.mealSwaps, [swapSlot]: id } }));
      setSwapSlot(null);
    };
    return (
      <WizardFrame
        testID="setup-swap"
        step={3}
        total={3}
        title={`Swap ${slotLabels[swapSlot].toLowerCase()}`}
        sub={`${draft.dietary.length ? `Only meals that fit: ${draft.dietary.map((x) => dietLabels[x]).join(', ')}.` : 'General sample meals.'} Always check ingredients and allergen labels yourself.`}
        onBack={() => setSwapSlot(null)}
        primary={{ title: 'Done', onPress: () => setSwapSlot(null) }}
      >
        {safe.map((m) => {
          const isCurrent = current?.label === m.label;
          return (
            <View key={m.id} style={[local.mealCard, isCurrent && local.mealCardOn]} testID={`swap-${m.id}`}>
              <Text style={local.mealTitle}>{m.label}</Text>
              <Text style={local.small}>{m.ingredients.map((i) => `${i.name}: ${i.measure}`).join(' · ')}</Text>
              <Pressable
                onPress={() => choose(m.id)}
                disabled={isCurrent}
                style={({ pressed }) => [local.use, pressed && local.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent, disabled: isCurrent }}
                accessibilityLabel={isCurrent ? `${m.label}, current` : `Use ${m.label}`}
              >
                <Text style={local.useText}>{isCurrent ? 'Current' : 'Use'}</Text>
              </Pressable>
            </View>
          );
        })}
        {!safe.length ? <Text style={local.body}>No sample meal fits your dietary needs for this meal, so it stays unplanned.</Text> : null}
        <TextLink title="Leave it unplanned" onPress={() => choose(null)} testID="swap-none" />
      </WizardFrame>
    );
  }

  // Refine with AI (optional, inline).
  if (aiOpen) {
    const failed = check && !check.ok ? check : null;
    const copy = async (what: 'prompt' | 'details', text: string) => {
      await Clipboard.setStringAsync(text);
      setCopied(what);
    };
    return (
      <WizardFrame
        testID="setup-ai"
        step={3}
        total={3}
        title="Refine with AI"
        sub="Optional. Copy a prompt to any AI chat assistant, then paste its reply."
        onBack={() => setAiOpen(false)}
        primary={{
          title: 'Check reply',
          disabled: !reply.trim(),
          onPress: () => {
            const r = checkSetupReply(starter, reply, draft, energy);
            setCheck(r);
            if (r.ok) {
              setAiPlan(r);
              setAiOpen(false);
            }
          },
        }}
      >
        <Card title="1 · Copy the prompt">
          <Text style={local.body}>It includes your answers and this starter plan. Nothing else.</Text>
          <Pressable onPress={() => copy('prompt', buildSetupPrompt(starter, draft, toLocalDate(new Date())))} style={({ pressed }) => [local.outline, pressed && local.pressed]} accessibilityRole="button" accessibilityLabel="Copy prompt" testID="setup-copy-prompt">
            <Text style={local.outlineText}>{copied === 'prompt' ? 'Copied: paste it into any AI chat' : 'Copy prompt'}</Text>
          </Pressable>
        </Card>
        <Card title="2 · Paste the reply">
          <TextInput
            value={reply}
            onChangeText={(t) => {
              setReply(t);
              setCheck(null);
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
            {failed.diagnostics ? <TextLink title={copied === 'details' ? 'Copied: paste it to the AI' : 'Copy details for the AI'} onPress={() => copy('details', failed.diagnostics!)} testID="setup-copy-details" /> : null}
          </View>
        ) : null}
        <Text style={ws.hint}>The reply is an AI-generated suggestion, not medical advice. You'll see every change before anything is saved.</Text>
      </WizardFrame>
    );
  }

  const shown = planToSave.activities as Record<string, any>[];
  const exercise = shown.filter((a) => a.kind !== 'meal');
  const removedExercise = (everything.activities as Record<string, any>[]).filter((a) => a.kind !== 'meal' && draft.removed.includes(a.id));
  const trainingDays = new Set(exercise.filter((a) => a.required !== false).flatMap(daysOf));
  const restDays = weekdays.filter((w) => !trainingDays.has(w));
  const options = activeNutritionSeed().mealOptions(draft.dietary);
  const slots = plannedSlots(draft.fitnessGoals);
  // Only what shapes the plan: goals, days, equipment and diet (gender, age and weight never change it).
  const based = [
    draft.fitnessGoals.map((g) => goalLabels[g].label).join(', '),
    draft.daysPerWeek ? `up to ${draft.daysPerWeek} days a week` : null,
    draft.equipment.length ? (draft.equipment.includes('none') ? 'no equipment' : draft.equipment.map((e) => equipmentLabels[e].toLowerCase()).join(', ')) : null,
    draft.dietary.map((x) => dietLabels[x]).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  const carousel = (label: string, n: number, count: number, onMove: (n: number) => void, testID: string) => (
    <View style={local.carousel} testID={testID}>
      <Pressable onPress={() => onMove((n + count - 1) % count)} style={local.arrow} accessibilityRole="button" accessibilityLabel="Previous option" testID={`${testID}-prev`}>
        <Text style={local.arrowText}>‹</Text>
      </Pressable>
      <View style={local.carouselText} accessibilityLiveRegion="polite">
        <Text style={local.carouselTitle}>{label}</Text>
        <Text style={local.small}>{`Option ${n + 1} of ${count}`}</Text>
      </View>
      <Pressable onPress={() => onMove((n + 1) % count)} style={local.arrow} accessibilityRole="button" accessibilityLabel="Next option" testID={`${testID}-next`}>
        <Text style={local.arrowText}>›</Text>
      </Pressable>
    </View>
  );

  const tabs = (
    <View style={local.tabs} accessibilityRole="tablist">
      {(['exercise', 'meals'] as const).map((t) => (
        <Pressable key={t} onPress={() => setTab(t)} style={[local.tab, tab === t && local.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} aria-selected={tab === t} testID={`tab-${t}`}>
          <Text style={[local.tabText, tab === t && local.tabTextOn]}>{t === 'exercise' ? 'Exercise' : 'Meals'}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <WizardFrame
      testID="setup-review"
      step={3}
      total={3}
      title={edit ? 'Rebuild starter plan' : 'Your starter plan'}
      sub={based ? `Based on: ${based}.` : 'Based on general beginner presets. Edit anything.'}
      onBack={() => (edit ? setRebuild(false) : go('goals'))}
      above={
        <>
          {tabs}
          {aiPlan
            ? null
            : tab === 'exercise'
              ? carousel(exerciseStyles[draft.exerciseOption].label, draft.exerciseOption, exerciseStyles.length, (n) => update((d) => ({ ...d, exerciseOption: n, removed: d.removed.filter((id) => !exercise.concat(removedExercise).some((a) => a.id === id)) })), 'exercise-options')
              : carousel(`Sample day ${draft.mealOption + 1}`, draft.mealOption, 3, (n) => update((d) => ({ ...d, mealOption: n, mealSwaps: {} })), 'meal-options')}
        </>
      }
      primary={{ title: startTitle, onPress: start, disabled: saving }}
    >
      {edit ? <ChangeSummary current={JSON.parse(edit.current.json)} next={replanExisting(JSON.parse(edit.current.json), planToSave)} /> : null}
      {aiPlan ? (
        <Card title="AI version" testID="review-ai">
          <Text style={local.body}>AI-generated suggestion, not medical advice. These are its changes:</Text>
          {aiPlan.preview.flatMap((p) => p.lines.map((l, i) => <Row key={`${p.section}-${i}`} title={l.text} sub={p.title} />))}
          {aiPlan.notes.map((n, i) => (
            <Text key={i} style={ws.hint}>
              {n}
            </Text>
          ))}
          <TextLink title="Use the presets instead" onPress={() => setAiPlan(null)} testID="review-ai-undo" />
        </Card>
      ) : null}

      {tab === 'exercise' ? (
        <View style={ws.question} testID="review-exercise">
          {exercise.map((a) => (
            <Row
              key={a.id}
              title={a.label}
              sub={[daysOf(a).map((x) => dayNames[x]).join(', '), a.duration?.minutes ? `${a.duration.minutes} min` : null, a.required === false ? 'optional' : null].filter(Boolean).join(' · ')}
              action={aiPlan ? undefined : { label: 'Remove', a11y: `Remove ${a.label}`, onPress: () => update((d) => ({ ...d, removed: [...d.removed, a.id] })) }}
              testID={`plan-${a.id}`}
            />
          ))}
          {removedExercise.map((a) => (
            <Row key={a.id} title={a.label} sub="Removed" muted action={{ label: 'Add back', a11y: `Add back ${a.label}`, onPress: () => update((d) => ({ ...d, removed: d.removed.filter((x) => x !== a.id) })) }} testID={`plan-${a.id}`} />
          ))}
          <Text style={ws.hint} testID="review-rest">{`Rest: ${restDays.map((x) => dayNames[x]).join(', ')}. Strength days never follow each other. Add a set or a few reps when it feels easy.`}</Text>
        </View>
      ) : (
        <View style={ws.question} testID="review-meals">
          {slots.map((s) => {
            const meal = shown.find((a) => a.id === s);
            const noneSafe = !options[s].length;
            return (
              <Row
                key={s}
                title={meal ? meal.label : 'Unplanned'}
                sub={meal ? `${slotLabels[s]} · ${(meal.ingredients as { measure: string; name: string }[]).map((i) => `${i.measure} ${i.name.toLowerCase()}`).join(', ')}` : noneSafe ? `${slotLabels[s]} · no sample meal fits your needs` : slotLabels[s]}
                muted={!meal}
                action={noneSafe || aiPlan ? undefined : { label: meal ? 'Swap' : 'Choose', a11y: `${meal ? 'Swap' : 'Choose'} ${slotLabels[s].toLowerCase()}`, onPress: () => setSwapSlot(s) }}
                testID={`meal-${s}`}
              />
            );
          })}
          <Text style={ws.hint} testID="review-meals-note">
            Sample meals are general suggestions, not a personalised nutrition plan and not food you've logged. Hand-sized portions are a rough guide: they don't guarantee enough energy or protein for you. The app filters by ingredient type, which can't guarantee a meal is free of an allergen: always check ingredients and allergen labels yourself.
          </Text>
        </View>
      )}

      {!aiPlan ? <TextLink title="Refine with AI (optional)" onPress={() => setAiOpen(true)} testID="review-refine" /> : null}
      {draft.exactWeight !== undefined ? <Text style={ws.hint} testID="review-weigh-in">{draft.logWeighIn ? `${draft.exactWeight} ${draft.unit} will be logged as today's weigh-in.` : 'Your weight is not logged as a weigh-in.'}</Text> : null}
      {saveError ? <Text style={local.error}>{`Couldn't save: ${saveError}`}</Text> : null}
      {confirmDialog}
    </WizardFrame>
  );
}

/** What a rebuild replaces, before the user confirms (#53). */
function ChangeSummary({ current, next }: { current: RawPlan; next: RawPlan }) {
  const local = useLocal();
  const ws = useWizardStyles();

  const c = rebuildSummary(current, next);
  return (
    <Card title="What will change" testID="rebuild-changes">
      {c.removed.length ? <Text style={local.body}>{`Removed: ${c.removed.join(', ')}.`}</Text> : null}
      {c.added.length ? <Text style={local.body}>{`Added: ${c.added.join(', ')}.`}</Text> : null}
      {c.dayTypes ? <Text style={local.body}>{`Day types ${c.dayTypes.join(', ')} become one "Every day" schedule.`}</Text> : null}
      {c.requirements.length ? <Text style={local.body}>{`Daily requirements removed: ${c.requirements.join(', ')}.`}</Text> : null}
      <Text style={ws.hint}>Kept: measurements, goals, nutrition targets, workout history and imports. You can undo this from Configure with AI.</Text>
    </Card>
  );
}

function Row({ title, sub, action, muted, testID }: { title: string; sub: string; action?: { label: string; a11y: string; onPress: () => void }; muted?: boolean; testID?: string }) {
  const local = useLocal();

  return (
    <View style={local.row} testID={testID}>
      <View style={local.rowText}>
        <Text style={[local.rowTitle, muted && local.muted]}>{title}</Text>
        {sub ? <Text style={local.small}>{sub}</Text> : null}
      </View>
      {action ? (
        <Pressable onPress={action.onPress} style={({ pressed }) => [local.rowAction, pressed && local.pressed]} accessibilityRole="button" accessibilityLabel={action.a11y}>
          <Text style={local.rowActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AgeQuestion({ draft, update }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void }) {
  const { colors, type } = useTheme();
  const local = useLocal();
  const ws = useWizardStyles();

  const [exact, setExact] = useState(draft.age !== undefined);
  const [text, setText] = useState(draft.age !== undefined ? String(draft.age) : '');
  const minor = isMinor(draft);
  return (
    <View style={ws.question} accessibilityLabel="Age">
      <Text style={type.section}>Age</Text>
      {exact ? (
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            const n = Number(t);
            update((d) => enterAge(d, t.trim() && Number.isInteger(n) && n > 0 && n <= 120 ? n : undefined));
          }}
          keyboardType="number-pad"
          placeholder="Age in years"
          placeholderTextColor={colors.faint}
          style={local.numberField}
          accessibilityLabel="Exact age in years"
          testID="setup-exact-age"
        />
      ) : (
        <Chips>
          {adultAgeBands.map((a) => (
            <Chip key={a} label={ageLabels[a]} selected={draft.ageBand === a} onPress={() => update((d) => chooseAgeBand(d, d.ageBand === a ? undefined : a))} testID={`age-${a}`} />
          ))}
        </Chips>
      )}
      <TextLink
        title={exact ? 'Choose a range instead' : 'Enter a specific age instead'}
        onPress={() => {
          setExact(!exact);
          setText('');
          update((d) => ({ ...d, age: undefined }));
        }}
        testID="setup-age-mode"
      />
      <Pressable
        onPress={() => update((d) => chooseAgeBand(d, d.ageBand === 'under_18' ? undefined : 'under_18'))}
        style={local.checkRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: minor }}
        aria-checked={minor}
        accessibilityLabel="I'm under 18: tracking only"
        testID="age-under_18"
      >
        <View style={[local.box, minor && local.boxOn]}>{minor ? <Text style={local.tick}>✓</Text> : null}</View>
        <Text style={local.body}>
          Under 18? <Text style={local.linkInline}>Tracking only</Text>
        </Text>
      </Pressable>
      {minor ? (
        <View style={local.notice} testID="setup-minor" accessibilityLiveRegion="polite">
          <Text style={local.noticeTitle}>Personalised plans are for adults</Text>
          <Text style={local.noticeText}>Exercise and meal plans in this app are for people 18 and over. You can still track your weight and anything you do.</Text>
        </View>
      ) : null}
    </View>
  );
}

function WeightQuestion({ draft, update }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void }) {
  const { colors, type } = useTheme();
  const local = useLocal();
  const ws = useWizardStyles();

  const [exact, setExact] = useState(draft.exactWeight !== undefined);
  const [text, setText] = useState(draft.exactWeight !== undefined ? String(draft.exactWeight) : '');
  return (
    <View style={ws.question} testID="setup-weight">
      <View style={local.weightHeader}>
        <Text style={type.section}>Weight</Text>
        <View style={local.units} accessibilityRole="radiogroup" accessibilityLabel="Units">
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
            style={local.numberField}
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
          <TextLink title="Enter a specific weight instead" onPress={() => setExact(true)} testID="setup-weight-exact" />
          <Text style={ws.hint}>A range is a rough guide for the plan. It's never recorded as a weigh-in or used for BMI.</Text>
        </>
      )}
    </View>
  );
}

function HeightQuestion({ draft, update }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void }) {
  const { colors, type } = useTheme();
  const local = useLocal();
  const ws = useWizardStyles();

  const inches = draft.unit === 'lb';
  const [text, setText] = useState(draft.heightCm ? String(inches ? cmToIn(draft.heightCm) : draft.heightCm) : '');
  return (
    <View style={ws.question}>
      <Text style={type.section}>{`Height (optional), ${inches ? 'in' : 'cm'}`}</Text>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = Number(t.replace(',', '.'));
          const cm = t.trim() && Number.isFinite(n) && n > 0 ? (inches ? inToCm(n) : n) : undefined;
          update((d) => ({ ...d, heightCm: cm !== undefined && cm >= 50 && cm <= 260 ? cm : undefined }));
        }}
        keyboardType="decimal-pad"
        placeholder={inches ? 'Height in inches' : 'Height in cm'}
        placeholderTextColor={colors.faint}
        style={local.numberField}
        accessibilityLabel={`Height in ${inches ? 'inches' : 'centimetres'}, optional`}
        testID="setup-height"
      />
      <Text style={ws.hint}>Only used for BMI, with an exact weight. Skip it if you like.</Text>
    </View>
  );
}

function GoalOption({ goal, selected, onToggle }: { goal: Goal; selected: boolean; onToggle: () => void }) {
  const local = useLocal();

  const g = goalLabels[goal];
  return (
    <Pressable
      onPress={onToggle}
      style={[local.option, selected && local.optionOn]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={g.label}
      accessibilityHint={g.detail}
      testID={`goal-${goal}`}
    >
      <View style={[local.box, selected && local.boxOn]}>{selected ? <Text style={local.tick}>✓</Text> : null}</View>
      <View style={local.optionText}>
        <Text style={local.optionTitle}>{g.label}</Text>
        <Text style={local.optionDetail}>{g.detail}</Text>
      </View>
    </Pressable>
  );
}

const useLocal = createThemedStyles(({ colors, type }) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21, flexShrink: 1 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  muted: { color: colors.muted },
  error: { fontSize: 14, color: colors.ink },
  pressed: { opacity: 0.75 },
  linkInline: { color: colors.accent, fontWeight: '700' },
  notice: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.accent, padding: space.md, gap: space.xs },
  noticeTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  noticeText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  errorPanel: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.ink, padding: space.lg, gap: space.sm },
  textField: { minHeight: touch, maxHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
  numberField: { minHeight: touch, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md, fontSize: 18, color: colors.ink },
  replyField: { minHeight: 110, maxHeight: 220, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bg, padding: space.md, fontSize: 13, color: colors.ink, fontFamily: 'monospace', textAlignVertical: 'top' },
  outline: { minHeight: touch, borderRadius: radius.md, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  outlineText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  weightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  units: { flexDirection: 'row', gap: space.xs },
  checkRow: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'flex-start' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  option: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  optionOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  optionDetail: { fontSize: 13, color: colors.muted },
  tabs: { flexDirection: 'row', backgroundColor: colors.line, borderRadius: radius.md, padding: 3 },
  tab: { flex: 1, minHeight: touch - 4, borderRadius: radius.md - 2, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.surface },
  tabText: { fontSize: 16, fontWeight: '600', color: colors.muted },
  tabTextOn: { fontWeight: '800', color: colors.ink },
  carousel: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  arrow: { minWidth: touch, minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 22, fontWeight: '700', color: colors.ink },
  carouselText: { flex: 1, alignItems: 'center' },
  carouselTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  row: { minHeight: touch + 8, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
  rowText: { flex: 1, gap: 2, paddingVertical: space.xs },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  rowAction: { minHeight: touch, minWidth: touch + 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  rowActionText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  mealCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.md, gap: space.xs },
  mealCardOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  mealTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  use: { minHeight: touch, minWidth: touch, alignSelf: 'flex-start', justifyContent: 'center' },
  useText: { fontSize: 15, fontWeight: '700', color: colors.accent },
}));
