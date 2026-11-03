import seed from '../../plans/seed.plan.json';
import { previewUpdate } from '../config/diff';
import { summarizeConfig } from '../config/summary';
import { applyConfigUpdate, parseConfigUpdate } from '../config/update';
import {
  convertEnergy,
  energyDisplayDetail,
  entryUnit,
  formatEnergy,
  formatEnergyBound,
  roundEnergy,
  speakEnergy,
  type EnergyDisplay,
} from '../energy';
import { formatAmount, formatTarget } from '../format';
import { formatObservationValue } from '../observations/format';
import { manualSource, type Observation } from '../observations/types';
import { mealNutrition } from '../plan/meals';
import { planSchema } from '../plan/schema';

const plan = planSchema.parse(seed);
const kcalPlan = planSchema.parse({ ...seed, units: { ...seed.units, energy: 'kcal' } });
const all: EnergyDisplay[] = ['kJ', 'kcal', 'both'];

const obs = (value: number, metric = 'active_energy'): Observation => ({
  id: 'o',
  date: '2026-11-03',
  metric,
  value,
  unit: 'kJ',
  kind: 'observed',
  label: null,
  note: null,
  source: manualSource(),
  recordedAt: '2026-11-03T08:00:00+11:00',
});

describe('energy conversion and rounding (#39)', () => {
  it('uses 1 kcal = 4.184 kJ, both ways', () => {
    expect(convertEnergy(4.184, 'kJ', 'kcal')).toBeCloseTo(1, 12);
    expect(convertEnergy(1, 'kcal', 'kJ')).toBe(4.184);
    expect(convertEnergy(1780, 'kJ', 'kJ')).toBe(1780);
    expect(convertEnergy(convertEnergy(1234.5, 'kJ', 'kcal'), 'kcal', 'kJ')).toBeCloseTo(1234.5, 9);
  });

  it('rounds kJ to the nearest 10 and kcal to the nearest whole number', () => {
    expect(roundEnergy(1339, 'kJ')).toBe(1340);
    expect(roundEnergy(1334.9, 'kJ')).toBe(1330);
    expect(roundEnergy(320.4, 'kcal')).toBe(320);
    expect(roundEnergy(320.5, 'kcal')).toBe(321);
    expect(Object.is(roundEnergy(-0.2, 'kcal'), 0)).toBe(true);
  });

  it('formats one stored value in each of the three displays', () => {
    expect(all.map((d) => formatEnergy(1780, 'kJ', d))).toEqual(['1,780 kJ', '425 kcal', '1,780 kJ / 425 kcal']);
    expect(all.map((d) => formatEnergy(7530, 'kJ', d))).toEqual(['7,530 kJ', '1,800 kcal', '7,530 kJ / 1,800 kcal']);
    // A value stored in kcal (a kcal plan) converts the other way.
    expect(all.map((d) => formatEnergy(520, 'kcal', d))).toEqual(['2,180 kJ', '520 kcal', '2,180 kJ / 520 kcal']);
  });

  it('rounds each shown number once from the stored value: no drift through a round trip', () => {
    // 1,339 kJ → 320.03 kcal. Converting the rounded "1,340" would give 320.27; both show 320, but a value near a
    // boundary shows the difference: 1,336 kJ = 319.31 kcal → 319, while from "1,340" it would be 320.
    expect(formatEnergy(1336, 'kJ', 'both')).toBe('1,340 kJ / 319 kcal');
  });

  it('formats target bounds with the sign once and a range per unit', () => {
    expect(all.map((d) => formatEnergyBound({ max: 7530 }, 'kJ', d))).toEqual(['≤ 7,530 kJ', '≤ 1,800 kcal', '≤ 7,530 kJ / 1,800 kcal']);
    expect(formatEnergyBound({ min: 6300 }, 'kJ', 'kcal')).toBe('≥ 1,506 kcal');
    expect(formatEnergyBound({ min: 6300, max: 7100 }, 'kJ', 'both')).toBe('6,300–7,100 kJ / 1,506–1,697 kcal');
  });

  it('speaks unit words, not abbreviations', () => {
    expect(speakEnergy('≈ 1,780 kJ / 425 kcal · 42 g protein')).toBe('≈ 1,780 kilojoules, 425 kilocalories · 42 g protein');
    expect(speakEnergy('Energy ≤ 1,800 kcal')).toBe('Energy ≤ 1,800 kilocalories');
    expect(speakEnergy('Energy 6,300–7,100 kJ / 1,506–1,697 kcal')).toBe('Energy 6,300–7,100 kilojoules, 1,506–1,697 kilocalories');
  });

  it('corrections are typed in the first unit shown', () => {
    expect(all.map(entryUnit)).toEqual(['kJ', 'kcal', 'kJ']);
  });

  it('menu row wording', () => {
    expect(all.map(energyDisplayDetail)).toEqual(['Energy in kJ', 'Energy in kcal', 'Energy in kJ and kcal']);
  });
});

describe('every energy surface follows the display (#39)', () => {
  const lunch = plan.activities.find((a) => a.id === 'lunch')!;
  const energyTarget = plan.nutrition.targets.find((t) => t.quantity === 'energy')!;
  const protein = plan.nutrition.targets.find((t) => t.quantity === 'grams')!;

  it('daily targets line; grams never change', () => {
    expect(all.map((d) => formatTarget(plan, energyTarget, d))).toEqual(['Energy ≤ 7,530 kJ', 'Energy ≤ 1,800 kcal', 'Energy ≤ 7,530 kJ / 1,800 kcal']);
    expect(all.map((d) => formatTarget(plan, protein, d))).toEqual(Array(3).fill('Protein 160–180 g'));
  });

  it('meal energy (card and sheet)', () => {
    expect(all.map((d) => mealNutrition(plan, lunch, d))).toEqual([
      '≈ 1,780 kJ · 42 g protein',
      '≈ 425 kcal · 42 g protein',
      '≈ 1,780 kJ / 425 kcal · 42 g protein',
    ]);
  });

  it('flexible-meal budget amount', () => {
    expect(all.map((d) => formatAmount(plan, 'energy', 2347, d))).toEqual(['2,350 kJ', '561 kcal', '2,350 kJ / 561 kcal']);
    expect(formatAmount(plan, 'grams', 55, 'both')).toBe('55 g');
  });

  it('recorded observations (incl. imported active energy) are stored in kJ and shown in the display', () => {
    const o = obs(1338.9);
    expect(all.map((d) => formatObservationValue(o, plan, d))).toEqual(['1,340 kJ', '320 kcal', '1,340 kJ / 320 kcal']);
    // Non-energy metrics ignore the setting.
    expect(all.map((d) => formatObservationValue(obs(8412, 'steps'), plan, d))).toEqual(Array(3).fill('8,412'));
  });

  it('a kcal plan converts its amounts too', () => {
    const t = kcalPlan.nutrition.targets.find((x) => x.quantity === 'energy')!;
    expect(formatTarget(kcalPlan, { ...t, max: 1800 }, 'kJ')).toBe('Energy ≤ 7,530 kJ');
  });

  it('Configure with AI preview and summary', () => {
    const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { targets: { merge: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 7100 }] } } } }));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const applied = applyConfigUpdate(seed as any, parsed.update);
    if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
    const text = (d: EnergyDisplay) => previewUpdate(seed as any, applied.nextRaw, parsed.update, d).flatMap((s) => s.lines.map((l) => l.text)).join('\n');
    expect(text('kJ')).toContain('≤ 7,530 kJ → ≤ 7,100 kJ');
    expect(text('kcal')).toContain('≤ 1,800 kcal → ≤ 1,697 kcal');
    expect(text('both')).toContain('≤ 7,530 kJ / 1,800 kcal → ≤ 7,100 kJ / 1,697 kcal');
    const summary = (d: EnergyDisplay) => summarizeConfig(seed as any, d).find((s) => s.section === 'nutrition')!.lines.join('\n');
    expect(summary('kcal')).toContain('Energy ≤ 1,800 kcal');
  });

  it('switching the display never touches the plan or a record', () => {
    const before = JSON.stringify(plan);
    const o = obs(1338.9);
    for (const d of all) {
      formatTarget(plan, energyTarget, d);
      mealNutrition(plan, lunch, d);
      formatObservationValue(o, plan, d);
    }
    expect(JSON.stringify(plan)).toBe(before);
    expect(o.value).toBe(1338.9);
    expect(o.unit).toBe('kJ');
  });
});
