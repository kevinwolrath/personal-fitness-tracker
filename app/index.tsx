import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const weekPlan: Record<number, string[]> = {
  0: ['Recovery / normal movement', 'VR boxing — 3 × 3 min'],
  1: ['8:30 school run — bike out / walk-jog home', '12:00 fixed lunch', '12:30 optional dog walk', '3:15 school run — walk-jog out / bike home', 'Resistance — 30–40 min', 'VR boxing — 3 × 3 min'],
  2: ['8:30 school run — bike out / walk-jog home', '12:00 fixed lunch', '12:30 optional dog walk', '3:15 school run — walk-jog out / bike home', 'VR boxing — 3 × 3 min'],
  3: ['8:30 school run — bike out / walk-jog home', '12:00 fixed lunch', '12:30 optional dog walk', '3:15 school run — walk-jog out / bike home', 'Resistance — 30–40 min', 'VR boxing — 3 × 3 min'],
  4: ['45 min drive to office', '12:00 fixed lunch', '30–45 min lunch walk', '45 min drive home', 'VR boxing — 3 × 3 min'],
  5: ['45 min drive to office', '12:00 fixed lunch', '30–45 min lunch walk', '45 min drive home', 'VR boxing — 3 × 3 min'],
  6: ['Normal weekend movement', 'Resistance — 45–60 min', 'VR boxing — 3 × 3 min'],
};

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function TodayScreen() {
  const now = useMemo(() => new Date(), []);
  const dayIndex = now.getDay();
  const [weight, setWeight] = useState('98.0');
  const [hunger, setHunger] = useState<string[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const toggle = (item: string) => setDone((current) => ({ ...current, [item]: !current[item] }));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>TODAY</Text>
        <Text style={styles.title}>{days[dayIndex]}</Text>
        <Text style={styles.subtitle}>{now.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>

        <View style={styles.heroCard}>
          <View>
            <Text style={styles.label}>Current weight</Text>
            <View style={styles.weightRow}>
              <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={styles.weightInput} />
              <Text style={styles.unit}>kg</Text>
            </View>
          </View>
          <View style={styles.goalBlock}>
            <Text style={styles.label}>Goal</Text>
            <Text style={styles.goal}>78 kg</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <Metric label="Energy" value="7,530 kJ" />
          <Metric label="Protein" value="160–180 g" />
          <Metric label="Eating" value="~12–8 pm" />
        </View>

        <Text style={styles.sectionTitle}>Plan</Text>
        <View style={styles.card}>
          {weekPlan[dayIndex].map((item) => (
            <Pressable key={item} onPress={() => toggle(item)} style={styles.row}>
              <View style={[styles.checkbox, done[item] && styles.checkboxDone]}>{done[item] ? <Text style={styles.tick}>✓</Text> : null}</View>
              <Text style={[styles.rowText, done[item] && styles.rowTextDone]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Food</Text>
        <View style={styles.card}>
          <Food title="Lunch" detail="Fixed cold high-protein lunch — no heating required" />
          <Food title="Snack" detail="Fixed anti-hunger snack before family dinner" />
          <Food title="Dinner" detail="Family dinner — timing usually 6:30–7:30 pm" />
        </View>

        <Pressable onPress={() => setHunger((events) => [...events, new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })])} style={styles.hungryButton}>
          <Text style={styles.hungryText}>I'M HUNGRY</Text>
        </Pressable>
        <Text style={styles.hungerNote}>Logs a hunger event for today{hunger.length ? ` • ${hunger.join(', ')}` : ''}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function Food({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.foodRow}><Text style={styles.foodTitle}>{title}</Text><Text style={styles.foodDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f0e8' },
  container: { padding: 20, paddingBottom: 48, gap: 12 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, color: '#6f6a5f' },
  title: { fontSize: 36, fontWeight: '900', color: '#171714' },
  subtitle: { fontSize: 16, color: '#6f6a5f', marginBottom: 8 },
  heroCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#171714', padding: 20, borderRadius: 22 },
  label: { color: '#aaa69d', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  weightRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  weightInput: { color: '#fff', fontSize: 34, fontWeight: '900', minWidth: 92, padding: 0 },
  unit: { color: '#ddd8cf', fontSize: 18, fontWeight: '700' },
  goalBlock: { alignItems: 'flex-end' },
  goal: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 6 },
  metricsRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: '#dfdbd0', borderRadius: 16, padding: 12 },
  metricLabel: { color: '#6f6a5f', fontSize: 11, fontWeight: '700' },
  metricValue: { color: '#171714', fontSize: 15, fontWeight: '900', marginTop: 4 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#171714', marginTop: 10 },
  card: { backgroundColor: '#fffdf8', borderRadius: 20, paddingHorizontal: 16 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd8cf' },
  checkbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: '#8b8578', alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: '#171714', borderColor: '#171714' },
  tick: { color: '#fff', fontWeight: '900' },
  rowText: { flex: 1, color: '#24221e', fontSize: 16, fontWeight: '700' },
  rowTextDone: { color: '#8b8578', textDecorationLine: 'line-through' },
  foodRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd8cf' },
  foodTitle: { fontSize: 16, fontWeight: '900', color: '#171714' },
  foodDetail: { marginTop: 4, color: '#6f6a5f', lineHeight: 20 },
  hungryButton: { backgroundColor: '#b5352b', minHeight: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  hungryText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  hungerNote: { textAlign: 'center', color: '#6f6a5f', fontSize: 12 },
});
