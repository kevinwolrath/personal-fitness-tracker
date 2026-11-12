import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import seed from '../../../../plans/seed.plan.json';
import { validatePlan } from '../../../plan/validate';
import { MemoryKeyValue, KeyValueTrackingStore } from '../../../storage/keyValueStore';
import { useApp } from '../../../providers/AppProvider';
import { CoverageSheet } from '../CoverageSheet';

jest.mock('../../../providers/AppProvider', () => ({ useApp: jest.fn() }));

it('keeps Reports selected while reporting/clearing, preserves advisory choices and uses the shared custom dose', async () => {
  const raw = { ...seed, formatVersion: 8, exercise: { equipment: [], customExercises: [{ movement: 'custom_hold', name: 'Custom hold', equipment: [], primary: ['biceps'], defaultDose: { sets: 4, seconds: 35 } }] } };
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  (useApp as jest.Mock).mockReturnValue({ plan: r.plan, store, dataVersion: 0, notifyDataChanged: jest.fn() });
  render(<CoverageSheet date="2026-11-12" editable onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('muscle-detail')).toHaveTextContent(/Not enough history/));
  fireEvent.press(screen.getByLabelText('Reports: soreness and injury'));
  fireEvent.press(screen.getByText('Report sore'));
  await waitFor(() => expect(screen.getByTestId('muscle-detail')).toHaveTextContent(/≋ Sore/));
  expect(screen.getByLabelText('Reports: soreness and injury')).toBeChecked();
  fireEvent.press(screen.getByText('Clear report'));
  await waitFor(() => expect(screen.getByTestId('reports-empty')).toBeTruthy());
  expect(screen.getByLabelText('Reports: soreness and injury')).toBeChecked();
  fireEvent.press(screen.getByText('Log exercise'));
  fireEvent.press(screen.getByLabelText('Choose Custom hold'));
  expect(screen.getByLabelText('Sets or rounds')).toHaveDisplayValue('4');
  expect(screen.getByLabelText('Seconds per round or set')).toHaveDisplayValue('35');
});
