import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { openStore } from '../../storage/openStore';
import { loadActivePlan } from '../../plan/bootstrap';
import { AppProvider } from '../AppProvider';
import seed from '../../../plans/seed.plan.json';
import { planSchema } from '../../plan/schema';

jest.mock('../../storage/openStore',()=>({openStore:jest.fn()}));
jest.mock('../../plan/bootstrap',()=>({loadActivePlan:jest.fn()}));
jest.mock('../../features/onboarding/SetupWizard',()=>({SetupWizard:()=>{const React=require('react');const {Text}=require('react-native');return React.createElement(Text,null,'Fictional setup');}}));
const open=openStore as jest.Mock, load=loadActivePlan as jest.Mock, hide=SplashScreen.hideAsync as jest.Mock;
beforeEach(()=>{jest.clearAllMocks();open.mockResolvedValue({});load.mockResolvedValue(planSchema.parse(seed));hide.mockResolvedValue(undefined);});
it('keeps approved loading art accessible while storage opens, then reveals tracking without an artificial delay',async()=>{
  let finish!:(s:object)=>void;open.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<AppProvider><Text>Tracking ready</Text></AppProvider>);
  expect(screen.getByLabelText('Body Anvil approved three-hero artwork')).toBeTruthy();
  expect(hide).not.toHaveBeenCalled();
  await act(async()=>finish({}));
  await waitFor(()=>expect(screen.getByText('Tracking ready')).toBeTruthy());
  await waitFor(()=>expect(hide).toHaveBeenCalled());
});
it('reveals first-run setup and also dismisses native splash on a storage error',async()=>{
  load.mockResolvedValue(null);
  const ui=render(<AppProvider><Text>Tracking ready</Text></AppProvider>);
  await waitFor(()=>expect(screen.getByText('Fictional setup')).toBeTruthy());
  expect(hide).toHaveBeenCalled();ui.unmount();
  open.mockRejectedValue(Error('Unavailable'));hide.mockClear();
  render(<AppProvider><Text>Tracking ready</Text></AppProvider>);
  await waitFor(()=>expect(screen.getByText("Couldn't load your plan")).toBeTruthy());
  await waitFor(()=>expect(hide).toHaveBeenCalled());
});
