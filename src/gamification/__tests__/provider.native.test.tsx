import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { GamificationProvider, useGamification, GAME_PREFERENCE } from '../GamificationProvider';
import { journeyPlan, journeySnapshot, START } from '../../../fixtures/gamification/journey';
import { secrets } from '../../platform/secrets';
jest.setTimeout(30000);

let mockSnapshot=journeySnapshot(0), mockVersion=0;
const mockPlan=journeyPlan, mockDate=START;
const mockStore={snapshot:jest.fn(async()=>mockSnapshot)};
jest.mock('../../providers/AppProvider',()=>({useApp:()=>({store:mockStore,plan:mockPlan,dataVersion:mockVersion})}));
jest.mock('../../features/daily-log/useDay',()=>({useClock:()=>({today:mockDate})}));
jest.mock('../../platform/secrets',()=>({secrets:{get:jest.fn(),set:jest.fn()}}));
function Probe() { const g=useGamification()!; return <><Text testID="state">{`${g.ready}:${g.enabled}:${g.game?.xp??0}:${g.celebration?.title??''}:${g.error??''}`}</Text><Pressable accessibilityRole="button" accessibilityLabel="Toggle" onPress={()=>g.setEnabled(!g.enabled)} /></>; }
beforeEach(()=>{ mockVersion=0; mockSnapshot=journeySnapshot(0); jest.clearAllMocks(); (secrets.get as jest.Mock).mockResolvedValue(null); (secrets.set as jest.Mock).mockResolvedValue(undefined); });
it('defaults old/malformed preferences off and never reads history until opt-in',async()=>{
  (secrets.get as jest.Mock).mockResolvedValue('{broken');
  render(<GamificationProvider><Probe /></GamificationProvider>);
  await act(async()=>{});
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('true:false'));
  expect(mockStore.snapshot).not.toHaveBeenCalled();
});
it('persists opt-in, celebrates live completion once, reverses XP and suppresses replay',async()=>{
  const ui=render(<GamificationProvider><Probe /></GamificationProvider>);
  await act(async()=>{});
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('true:false'));
  await act(async()=>fireEvent.press(screen.getByRole('button',{name:'Toggle'})));
  await waitFor(()=>expect(mockStore.snapshot).toHaveBeenCalled());
  mockSnapshot=journeySnapshot(1); mockVersion++;
  ui.rerender(<GamificationProvider><Probe /></GamificationProvider>);
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('60:Achievement unlocked'));
  expect(secrets.set).toHaveBeenCalledWith(GAME_PREFERENCE,expect.stringContaining('achievement:first'));
  mockSnapshot=journeySnapshot(0); mockVersion++;
  ui.rerender(<GamificationProvider><Probe /></GamificationProvider>);
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('true:true:0'));
  await act(async()=>fireEvent.press(screen.getByRole('button',{name:'Toggle'})));
  await act(async()=>fireEvent.press(screen.getByRole('button',{name:'Toggle'})));
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toBe('true:true:0::'));
});
it('reports failed preference writes while keeping the session choice usable',async()=>{
  (secrets.set as jest.Mock).mockRejectedValue(Error('disk full'));
  render(<GamificationProvider><Probe /></GamificationProvider>);
  await act(async()=>{});
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('true:false'));
  await act(async()=>fireEvent.press(screen.getByRole('button',{name:'Toggle'})));
  await waitFor(()=>expect(screen.getByTestId('state').props.children).toContain('Could not save gamification'));
});
