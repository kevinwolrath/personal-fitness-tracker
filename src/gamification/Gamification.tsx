import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useGamification } from './GamificationProvider';
import { RECOVERY_LOG, scoring } from './model';
import { useApp } from '../providers/AppProvider';
import { newId } from '../storage/types';
import { useClock } from '../features/daily-log/useDay';
import { createThemedStyles, space, radius, useTheme } from '../ui/theme';
import { Sheet } from '../ui/Sheet';
import { ModalHeader } from '../ui/ModalHeader';
import { ScrollView } from '../ui/ScrollView';
import { Button } from '../ui/Button';

function Badge({ locked = false, large = false }: { locked?: boolean; large?: boolean }) {
  return <Image source={require('../../assets/hero-forge/achievements/forge-emblem.png')} accessibilityLabel={locked ? 'Locked industrial achievement badge' : 'Unlocked industrial achievement badge'} style={{ width: large ? 120 : 64, height: large ? 120 : 64, opacity: locked ? 0.25 : 1 }} resizeMode="contain" />;
}

export function GamificationSettings() {
  const game = useGamification();
  const { type } = useTheme(); const styles = useStyles();
  if (!game) return null;
  return <View style={styles.card}>
    <Pressable accessibilityRole="switch" accessibilityLabel="Gamification" accessibilityState={{ checked: game.enabled, disabled: !game.ready }} aria-checked={game.enabled} disabled={!game.ready} onPress={() => game.setEnabled(!game.enabled)} style={styles.toggle} testID="gamification-toggle">
      <Text style={type.body}>Quests & achievements</Text><Text style={styles.highlight}>{game.enabled ? 'On' : 'Off'}</Text>
    </Pressable>
    <Text style={type.detail}>Optional, quiet rewards for your plan. No streak pressure. Turn off to hide quests, XP and celebrations; tracking continues.</Text>
    {game.error && <Text accessibilityLiveRegion="polite" style={type.detail}>{game.error}</Text>}
  </View>;
}

export function GamificationCard({ gallery = false }: { gallery?: boolean }) {
  const state = useGamification(); const { type } = useTheme(); const styles = useStyles();
  const { store, plan } = useApp(); const { today } = useClock();
  const [open,setOpen] = useState(false), [saving,setSaving] = useState(false), [error,setError] = useState<string | null>(null);
  if (!state?.enabled) return null;
  const game = state.game;
  // #176: never an endless spinner: while loading say so; on a failure, say what happened and offer Retry.
  if (!game) {
    if (state.loadFailed) return <View style={styles.card} testID="gamification-error"><Text style={type.detail} accessibilityLiveRegion="polite">{state.error}</Text><Button title="Retry" variant="secondary" disabled={state.loading} onPress={state.retry} testID="gamification-retry" /></View>;
    return <Text style={type.detail} testID="gamification-loading">{state.error ?? 'Loading quests…'}</Text>;
  }
  const recovery = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try { const day = await store.getDay(plan.id,today); const old = day.quickLogs.find(q => q.quickLogId === RECOVERY_LOG); if (!old) await store.addQuickLog({ id:newId(),planId:plan.id,date:today,quickLogId:RECOVERY_LOG,at:new Date().toISOString() }); }
    catch { setError('Could not save recovery. Try again.'); }
    finally { setSaving(false); }
  };
  const undoRecovery = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try { const day = await store.getDay(plan.id,today); for (const q of day.quickLogs.filter(q => q.quickLogId === RECOVERY_LOG)) await store.removeQuickLog(q.id); }
    catch { setError('Could not undo recovery. Try again.'); }
    finally { setSaving(false); }
  };
  return <>
    <View style={styles.card} testID="gamification-card">
      <View style={styles.row}><Badge /><View style={styles.flex}><Text style={type.section}>{gallery ? 'Your forge' : 'Plan quests'}</Text><Text style={type.body} testID="game-level">Level {game.level} · {game.xp} XP</Text><Text style={type.detail}>{game.next} XP to next level</Text></View></View>
      {!gallery && <><Text style={type.detail}>{game.quests.filter(q=>q.done).length} / {game.quests.length} daily quests · up to {scoring.dailyCap} XP/day</Text><Text style={type.detail}>{game.weekly.label} · {game.weekly.xp} XP{game.weekly.done ? ' · Complete' : ''}</Text></>}
      <Button title={gallery ? 'Achievement gallery' : 'View quests & achievements'} variant="quiet" onPress={() => setOpen(true)} testID="open-achievements" />
      {state.error && <Text style={type.detail} accessibilityLiveRegion="polite">{state.error}</Text>}
      {state.loadFailed && <Button title="Retry" variant="quiet" disabled={state.loading} onPress={state.retry} testID="gamification-retry" />}
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} label="Quests & achievements" fill>
      <ModalHeader title="Your forge" dismiss={{ label:'Close',onPress:()=>setOpen(false) }} />
      <ScrollView contentContainerStyle={styles.body} testID="achievement-gallery">
        <Text style={type.body}>Level {game.level} · {game.xp} XP</Text>
        <Text style={type.detail}>Record activities in your daily log. Rewards update when records are corrected. No lost streaks, no extra XP for doing more than planned.</Text>
        <Text style={type.section}>Today's quests</Text>
        {game.quests.length === 0 && <Text style={type.detail}>No eligible plan quests today. Your tracking is still available.</Text>}
        {game.quests.map(q => <View key={q.id} style={styles.quest} testID={`quest-${q.id.split(':').pop()}`}><Text style={type.body}>{q.label}</Text><Text style={type.detail}>{q.done ? 'Complete' : 'Ready when you are'} · {q.xp} XP</Text>{q.recovery && <Button title={q.done ? 'Undo recovery' : 'Log recovery'} variant="secondary" disabled={saving} onPress={q.done ? undoRecovery : recovery} />}</View>)}
        {error && <Text style={type.detail} accessibilityLiveRegion="polite">{error}</Text>}
        <Text style={type.body}>{game.weekly.label}{game.weekly.done ? ' · Complete' : ''}</Text>
        <Text style={type.section}>Achievements · {game.achievements.filter(a=>a.unlocked).length} / {game.achievements.length}</Text>
        {game.achievements.map(a => <View key={a.id} style={styles.row} testID={`achievement-${a.id}`} accessibilityLabel={`${a.title}: ${a.unlocked ? 'Unlocked' : 'Locked'}`}><Badge locked={!a.unlocked} /><View style={styles.flex}><Text style={type.body}>{a.title}</Text><Text style={styles.highlight}>{a.unlocked ? 'Unlocked' : 'Locked'} · {a.progress}</Text><Text style={type.detail}>{a.detail}</Text></View></View>)}
        <Text style={type.detail}>Metallic badge frames mark your progress. Weight, waist and performance milestones award recognition, never weight-loss or workout-volume XP.</Text>
      </ScrollView>
    </Sheet>
  </>;
}

/** Inline, dismissible celebration: no animation, modal interruption, sound, timer or notification. */
export function GamificationCelebration() {
  const state = useGamification(); const { type } = useTheme(); const styles = useStyles();
  if (!state?.enabled || !state.celebration) return null;
  return <View style={styles.celebration} accessibilityLiveRegion="polite" testID="game-celebration"><View style={styles.row}><Badge /><View style={styles.flex}><Text style={type.body}>{state.celebration.title}</Text><Text style={type.detail}>{state.celebration.detail}</Text></View></View><Button title="Continue" variant="quiet" onPress={state.dismiss} /></View>;
}
const useStyles = createThemedStyles(({ colors }) => ({
  card: { padding:space.md, gap:space.xs, borderRadius:radius.md, backgroundColor:colors.surface, borderWidth:1, borderColor:colors.line },
  celebration: { padding:space.md, gap:space.xs, borderRadius:radius.md, backgroundColor:colors.surface, borderWidth:2, borderColor:colors.accent },
  toggle: { minHeight:56, flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:space.md,flexWrap:'wrap' },
  row: { flexDirection:'row',alignItems:'center',gap:space.md,paddingVertical:space.sm }, flex:{ flex:1 },
  highlight:{ color:colors.accent,fontSize:14,fontWeight:'700' }, body:{ gap:space.lg,paddingBottom:space.xxl },
  quest:{ gap:space.sm,paddingVertical:space.sm,borderBottomWidth:1,borderBottomColor:colors.line },
}));
