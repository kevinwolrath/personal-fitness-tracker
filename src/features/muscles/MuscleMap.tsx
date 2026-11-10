import { useId } from 'react';
import { Text, View } from 'react-native';
import Svg, { Defs, G, Image as SvgImage, Path, Pattern } from 'react-native-svg';
import type { MuscleCoverage } from '../../exercises/coverage';
import { useTheme } from '../../ui/theme';
import { artwork, characterFor, regions, type BodyView } from './artwork';

export type MapMode = 'priority' | 'activated' | 'reports';
export function coverageLabel(c: MuscleCoverage): string {
  if (c.report) return c.report === 'injured' ? '! Injured' : '≋ Sore';
  return ({ unknown: 'Not enough history', green: 'Coverage on track', amber: 'Approaching target', red: 'Priority for training', recovering: 'Recovering', unavailable: 'Reported unavailable' })[c.status];
}
/** What each mode draws (#75): the legend only names marks that mode can show. */
const legend: Record<MapMode, string> = {
  priority: '◇ Outline: below this week’s target · ≋ Sore diagonal hatch · ! Injured cross-hatch. Costume orange is not a status.',
  reports: '≋ Sore diagonal hatch · ! Injured cross-hatch. Costume orange is not a status.',
  activated: '● Primary · dashed secondary. Activation preview only; not a completion.',
};
/** One shared pixel coordinate system for the supplied PNG and every independent region. */
export function MuscleMap({ gender, coverage = [], mode = 'priority', activated = [], secondary = [], selected, onSelect, compact = false }: {
  gender?: unknown; coverage?: MuscleCoverage[]; mode?: MapMode; activated?: string[]; secondary?: string[];
  selected?: string; onSelect?: (id: string) => void; compact?: boolean;
}) {
  const { colors, type } = useTheme();
  const c = characterFor(gender);
  const key = useId().replace(/[^a-zA-Z0-9]/g, '');
  return <View testID="muscle-map-art">
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
      {(['front', 'back'] as BodyView[]).map(view => <View key={view} style={{ width: '50%', maxWidth: compact ? 100 : 210 }}>
        <Svg viewBox="180 0 664 1536" width="100%" style={{ aspectRatio: 664 / 1536 }} accessibilityLabel={`${c}, ${view} muscle map. Use the muscle list for status and selection.`}>
          <Defs>
            <Pattern id={`${key}-${view}-sore`} width={18} height={18} patternUnits="userSpaceOnUse"><Path d="M-3 3L3 -3M0 18L18 0M15 21L21 15" stroke={colors.sore} strokeWidth={6} /></Pattern>
            <Pattern id={`${key}-${view}-injured`} width={20} height={20} patternUnits="userSpaceOnUse"><Path d="M0 0L20 20M20 0L0 20" stroke={colors.injured} strokeWidth={5} /></Pattern>
          </Defs>
          <SvgImage href={artwork[c][view]} x={0} y={0} width={1024} height={1536} preserveAspectRatio="xMidYMid meet" />
          {Object.entries(regions[c][view]).map(([muscle, paths]) => {
            const state = coverage.find(m => m.muscle === muscle);
            const report = mode !== 'activated' ? state?.report : null;
            const active = mode === 'activated' && (activated.includes(muscle) || secondary.includes(muscle));
            const priority = mode === 'priority' && !report && (state?.status === 'red' || state?.status === 'amber');
            const chosen = selected === muscle;
            const color = report === 'injured' ? colors.injured : report === 'sore' ? colors.sore : active ? colors.activated : priority ? colors.priority : colors.onCard;
            return <G key={muscle} onPress={onSelect ? () => onSelect(muscle) : undefined}>
              <Path testID={`muscle-${view}-${muscle}`} d={paths.join(' ')} stroke={active || priority || report || chosen ? color : 'none'} strokeWidth={chosen ? 9 : 5}
                strokeDasharray={active && secondary.includes(muscle) ? '12 8' : undefined}
                fill={report ? `url(#${key}-${view}-${report})` : active ? color : 'transparent'} fillOpacity={active ? activated.includes(muscle) ? 0.55 : 0.28 : report ? 0.8 : 0} />
            </G>;
          })}
        </Svg>
        {!compact && <Text style={[type.detail, { textAlign: 'center' }]}>{view === 'back' ? 'Rear' : 'Front'}</Text>}
      </View>)}
    </View>
    {!compact && <Text style={[type.detail, { marginTop: 8 }]}>{legend[mode]}</Text>}
  </View>;
}
