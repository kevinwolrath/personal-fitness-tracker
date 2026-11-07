import { useState } from 'react';
import { Text, View } from 'react-native';
import { findInventoryExercise, exerciseInventory } from '../../exercises/inventory';
import { Button } from '../../ui/Button';
import { useTheme } from '../../ui/theme';
import { MuscleMap } from './MuscleMap';
export function ExerciseMuscles({ movement, gender }: { movement: string; gender?: unknown }) {
  const { type } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const exercise = findInventoryExercise(movement);
  if (!exercise) return null;
  const labels = (ids: string[]) => ids.map(id => exerciseInventory.muscleGroups.find(m => m.id === id)?.label).join(', ') || 'None';
  return <View style={{ gap: 8 }}>
    <Text style={type.section}>Muscles used</Text>
    <Text style={type.detail}>Primary: {labels(exercise.primary)}</Text>
    <Text style={type.detail}>Secondary: {labels(exercise.secondary)}</Text>
    <Button title={expanded ? 'Hide activated muscles' : 'Show activated muscles'} variant="secondary" onPress={() => setExpanded(!expanded)} />
    {expanded && <MuscleMap gender={gender} mode="activated" activated={exercise.primary} secondary={exercise.secondary} />}
  </View>;
}
