import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import seed from '../../../../plans/seed.plan.json';
import { validatePlan } from '../../../plan/validate';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { MyGymSheet } from '../MyGymSheet';
import { useApp } from '../../../providers/AppProvider';

jest.mock('../../../providers/AppProvider', () => ({ useApp: jest.fn() }));

it('native grouped checklist renders bundled equipment images, searches collapsed groups and saves only access', async () => {
  const raw = { ...seed, formatVersion: 9, exercise: { ...seed.exercise, equipment: [] } };
  const result = validatePlan(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  await store.setActivePlan({ planId: raw.id, revision: raw.revision, formatVersion: 9, json: JSON.stringify(raw), importedAt: '2026-11-12T00:00:00Z', origin: 'config' });
  (useApp as jest.Mock).mockReturnValue({ plan: result.plan, store, reloadPlan: jest.fn(), notifyDataChanged: jest.fn() });
  render(<MyGymSheet onClose={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Search equipment'), 'Fixed dumbbells');
  expect(screen.getByRole('image', { name: 'Fixed dumbbells' })).toBeTruthy();
  fireEvent.press(screen.getByRole('checkbox', { name: 'Fixed dumbbells' }));
  await waitFor(async () => expect(JSON.parse((await store.getActivePlan())!.json).exercise.equipment).toEqual([expect.objectContaining({ catalogueId: 'dumbbells_fixed' })]));
  expect(JSON.parse((await store.getActivePlan())!.json).activities).toEqual(raw.activities);
});
