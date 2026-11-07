import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { formatClock } from '../../format';
import { notifications } from '../../platform/notifications';
import type { Reminder } from '../../reminders/schedule';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { useReminders } from './RemindersProvider';

const clock = (minute: number) => formatClock(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);

/** "Off · meal reminders from your plan", "On · next: Fixed lunch at 11:55 am", … for the menu row. */
export function remindersStatus(s: { enabled: boolean; permission: string; today: Reminder[]; planHasReminders: boolean }, nowMinute: number): string {
  if (!s.planHasReminders) return 'Your plan has no reminders';
  if (!s.enabled) return 'Off · reminders from your plan';
  if (s.permission !== 'granted') return 'Blocked in system settings';
  const next = s.today.find((r) => r.status === 'pending' && r.minute > nowMinute);
  return next ? `On · next: ${next.activityLabel} at ${clock(next.minute)}` : 'On · nothing more today';
}

/** Reminders (contract 10): explicit opt-in, a status, and what the plan reminds about. Read-only otherwise. */
export function RemindersSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const r = useReminders();
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const blocked = r.enabled && r.permission === 'denied';
  const on = r.enabled && r.permission === 'granted';
  // One row per reminder defined for today, in time order.
  const rows = r.today;

  return (
    <Sheet visible={visible} onClose={onClose} label="Reminders">
      <ModalHeader title="Reminders" dismiss={{ label: 'Close', onPress: onClose }} />
      <View style={styles.body} testID="reminders-sheet">
        {r.enabled ? (
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.switchLabel}>Plan reminders</Text>
              <Text style={type.detail} testID="reminders-status">
                {remindersStatus(r, nowMinute)}
              </Text>
            </View>
            <Switch
              {...(Platform.OS === 'web' ? ({ activeThumbColor: colors.surface } as object) : {})}
              value={r.enabled}
              onValueChange={(v) => (v ? r.enable() : r.disable())}
              trackColor={{ true: colors.accent, false: colors.line }}
              thumbColor={colors.surface}
              accessibilityLabel="Plan reminders"
              testID="reminders-switch"
            />
          </View>
        ) : (
          <Text style={type.detail}>
            A notification on this phone at the times your plan sets. Nothing is sent anywhere, and anything you've already done or skipped
            stays quiet.
          </Text>
        )}

        {blocked && (
          <View style={styles.blocked} testID="reminders-blocked">
            <Text style={styles.blockedText}>Notifications are blocked for this app in system settings, so reminders can't appear.</Text>
            {notifications.real && (
              <Pressable onPress={r.openSettings} style={styles.link} accessibilityRole="button" accessibilityLabel="Open settings">
                <Text style={styles.linkText}>Open settings</Text>
              </Pressable>
            )}
          </View>
        )}

        {r.planHasReminders ? (
          <View>
            <Text style={type.section}>{on ? 'Today' : 'Your plan reminds you about'}</Text>
            {rows.map((x) => {
              const quiet = x.status !== 'pending';
              return (
                <View key={x.id} style={styles.row} testID={`reminder-${x.activityId}`}>
                  <View style={styles.flex}>
                    <Text style={[styles.rowLabel, quiet && styles.quiet]}>{x.activityLabel}</Text>
                    <Text style={type.detail}>{quiet ? `Already ${x.status} · won't remind` : `“${x.body}”`}</Text>
                  </View>
                  <Text style={[styles.time, quiet && styles.quietTime]}>{clock(x.minute)}</Text>
                </View>
              );
            })}
            <Text style={[type.detail, styles.hint]}>Change or add reminders with Configure with AI.</Text>
          </View>
        ) : (
          <Text style={type.detail}>Your plan has no reminders. Add them with Configure with AI, e.g. "remind me 5 minutes before lunch".</Text>
        )}

        {!r.enabled && r.planHasReminders && (
          <View style={styles.actions}>
            <Button title="Turn on reminders" onPress={r.enable} />
            <Text style={[type.detail, styles.center]}>
              {notifications.real ? 'Your phone will ask once for permission to notify.' : 'This test surface simulates notifications.'}
            </Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  body: { gap: space.md, paddingBottom: space.md },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 8 },
  switchLabel: { fontSize: 17, fontWeight: '700', color: colors.ink },
  blocked: { backgroundColor: colors.bg, borderRadius: 14, padding: space.md, gap: space.xs },
  blockedText: { ...type.body, fontSize: 15, fontWeight: '500' },
  link: { minHeight: touch, justifyContent: 'center' },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  quiet: { color: colors.muted, textDecorationLine: 'line-through' },
  time: { fontSize: 15, fontWeight: '700', color: colors.ink, ...type.number },
  quietTime: { color: colors.muted, fontWeight: '500' },
  hint: { marginTop: space.sm },
  actions: { gap: space.sm },
  center: { textAlign: 'center' },
}));
