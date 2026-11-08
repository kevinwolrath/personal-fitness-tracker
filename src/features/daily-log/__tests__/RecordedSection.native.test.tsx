import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordedSection } from '../RecordedSection';
import { planSchema } from '../../../plan/schema';
import seed from '../../../../plans/seed.plan.json';
import fixture from '../../../../e2e/fixtures/walking-health-connect.json';
import { mapHealthConnect, type HcRead } from '../../../observations/healthConnect';

test('walking starts compact, expands source records and retains drill-down without inflated time', () => {
  const onOpen = jest.fn();
  const observations = mapHealthConnect(fixture.data as HcRead, ['2026-11-02'], '2026-11-02T12:00:00+11:00', s => s.slice(0,10)).observations;
  render(<RecordedSection plan={planSchema.parse(seed)} energy="kJ" observations={observations} outsidePlan={[]} onOpen={onOpen} />);
  const summary = screen.getByTestId('recorded-walking-summary');
  expect(summary).toHaveTextContent(/1 hr 45 min/);
  expect(summary).toHaveTextContent(/4\.8 km recorded/);
  expect(screen.queryByTestId('recorded-walking-records')).toBeNull();
  fireEvent.press(summary);
  expect(screen.getAllByTestId('recorded-exercise_session')).toHaveLength(4);
  expect(screen.getByText('Overlapping source record')).toBeTruthy();
  fireEvent.press(screen.getAllByTestId('recorded-exercise_session')[0]);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({activity:expect.objectContaining({distanceMeters:3000})}));
  fireEvent.press(summary);
  expect(screen.queryByTestId('recorded-walking-records')).toBeNull();
});
