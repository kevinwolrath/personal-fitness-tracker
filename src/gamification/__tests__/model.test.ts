import { journeyPlan, journeySnapshot, observation, START } from '../../../fixtures/gamification/journey';
import { gameFrom, scoring } from '../model';
import { addDays } from '../../plan/dates';
import { KeyValueTrackingStore } from '../../storage/keyValueStore';
import { observableStore } from '../../storage/observableStore';
import { planSchema } from '../../plan/schema';

it('starts at level one with locked badges and derives quests from the plan',()=>{
  const g=gameFrom(journeySnapshot(0),journeyPlan,START);
  expect(g.xp).toBe(0); expect(g.level).toBe(1); expect(g.achievements.every(a=>!a.unlocked)).toBe(true);
  expect(g.quests.map(q=>q.id.split(':').pop())).toEqual(expect.arrayContaining(['strength','nutrition','walking']));
});
it('recomputes XP after duplicates, corrections, backdating, future records and deletion',()=>{
  const s=journeySnapshot(1), original=gameFrom(s,journeyPlan,START);
  expect(original.xp).toBe(60);
  s.observations.push({...s.observations[0],id:'duplicate',source:{...s.observations[0].source,type:'integration'}});
  s.activityLogs.push({...s.activityLogs[0]});
  expect(gameFrom(s,journeyPlan,START)).toEqual(original);
  s.activityLogs=s.activityLogs.filter(l=>l.activityId!=='strength');
  expect(gameFrom(s,journeyPlan,START).xp).toBe(original.xp-scoring.quest);
  s.observations=s.observations.filter(o=>o.metric!=='steps');
  expect(gameFrom(s,journeyPlan,START).xp).toBe(20);
  s.observations.push(observation('steps',10000,addDays(START,1)));
  expect(gameFrom(s,journeyPlan,START).xp).toBe(20);
  expect(gameFrom(s,journeyPlan,addDays(START,1)).xp).toBe(40);
});
it('caps purpose rewards, shares alternatives, rewards rest, and gives no volume/calorie XP',()=>{
  const s=journeySnapshot(7), base=gameFrom(s,journeyPlan,addDays(START,6));
  s.observations.push(observation('energy_intake',1,START),observation('total_energy',90000,START),observation('exercise_session',10000,START));
  for(let i=0;i<50;i++) s.exerciseLogs!.push({id:String(i),movement:'push_up',date:START,at:START,sets:20,reps:100,seconds:null,intensity:'hard'});
  expect(gameFrom(s,journeyPlan,addDays(START,6)).xp).toBe(base.xp);
  expect(base.achievements.find(a=>a.id==='performance')?.unlocked).toBe(false);
  const rest=gameFrom(s,journeyPlan,'2026-07-05');
  expect(rest.quests.find(q=>q.recovery)?.done).toBe(true);
  expect(rest.quests.some(q=>q.id.endsWith(':strength'))).toBe(false);
});
it('recognizes user goals and long-term progress without adding weight-loss XP',()=>{
  const s=journeySnapshot(121),g=gameFrom(s,journeyPlan,addDays(START,120));
  expect(g.level).toBeGreaterThan(20); expect(g.activeDays).toBe(121);
  expect(g.achievements.filter(a=>a.id.includes(':goal:')).every(a=>a.unlocked)).toBe(true);
  const xp=g.xp; s.observations=s.observations.filter(o=>!['weight','waist','pushups'].includes(o.metric));
  expect(gameFrom(s,journeyPlan,addDays(START,120)).xp).toBe(xp);
  expect(gameFrom(s,journeyPlan,addDays(START,120)).achievements.filter(a=>a.id.includes(':goal:')).every(a=>!a.unlocked)).toBe(true);
});
it('rejects rapid weight loss and suppresses training rewards while injured',()=>{
  const s=journeySnapshot(1); s.observations.push(observation('weight',92,addDays(START,28)));
  expect(gameFrom(s,journeyPlan,addDays(START,28)).achievements.find(a=>a.id.includes('weight-goal:goal'))?.unlocked).toBe(false);
  s.muscleReports=[{id:'injury',muscle:'chest',kind:'injured',at:START,clearedAt:null}];
  const g=gameFrom(s,journeyPlan,START);
  expect(g.xp).toBe(40); expect(g.quests.some(q=>q.recovery)).toBe(true);
});
it('round-trips legacy tracking and emits changes only after successful persistence',async()=>{
  const data=new Map<string,string>(); const kv={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
  data.set('pft:tracking:v1',JSON.stringify({version:1,plan:null,activities:{},overrides:{},observations:[],quickLogs:[],imports:[]}));
  const changed=jest.fn(),store=observableStore(new KeyValueTrackingStore(kv),changed);
  const s=journeySnapshot(50); await store.restore(s); expect(changed).toHaveBeenCalledTimes(1);
  const before=gameFrom(await store.snapshot(),journeyPlan,addDays(START,49));
  const reopened=new KeyValueTrackingStore(kv);
  expect(gameFrom(await reopened.snapshot(),journeyPlan,addDays(START,49))).toEqual(before);
  const failing=observableStore(new KeyValueTrackingStore({getItem:kv.getItem,setItem:()=>{throw Error('full');}}),changed);
  await expect(failing.addObservations([observation('steps',1,START)])).rejects.toThrow('full');
  expect(changed).toHaveBeenCalledTimes(1);
});

it('collapses completed requirement alternatives into one reward',()=>{
  const strength=journeyPlan.activities.find(a=>a.id==='strength')!;
  const plan=planSchema.parse({...journeyPlan,requirements:[{id:'strength-need',label:'Strength choice',purpose:'strength'}],activities:[...journeyPlan.activities.filter(a=>a.id!=='strength'),{...strength,satisfies:'strength-need'},{...strength,id:'alternative',label:'Alternative strength',satisfies:'strength-need'}]});
  const s=journeySnapshot(1);
  s.activityLogs.push({...s.activityLogs.find(l=>l.activityId==='strength')!,activityId:'alternative'});
  const g=gameFrom(s,plan,START);
  expect(g.xp).toBe(60); expect(g.quests.filter(q=>q.id.endsWith(':strength'))).toHaveLength(1);
});
it('keeps saved historical quest membership and uses manual observation precedence',()=>{
  const s=journeySnapshot(1);
  s.daySnapshots.push({planId:journeyPlan.id,date:START,planRevision:1,updatedAt:START,prescribed:{items:[{key:'strength',kind:'activity',label:'Original strength',purpose:'strength',options:[]}]}});
  const renamed=planSchema.parse({...journeyPlan,revision:2,activities:journeyPlan.activities.filter(a=>a.id!=='strength')});
  expect(gameFrom(s,renamed,START).xp).toBe(20);
  s.daySnapshots=[];
  s.observations=s.observations.filter(o=>o.metric!=='steps');
  s.observations.push({...observation('steps',10000,START,'hc'),source:{...observation('steps',0,START).source,type:'integration'}},observation('steps',100,START,'manual'),{...observation('steps',99999,START,'inferred'),kind:'inferred'});
  expect(gameFrom(s,journeyPlan,START).quests.find(q=>q.id.endsWith(':walking'))?.done).toBe(false);
});
it('actual meal logs share the nutrition reward with checklist meals and reverse on removal',()=>{
  const s=journeySnapshot(0);
  s.mealLogs=[{id:'meal',date:START,at:START,planId:journeyPlan.id,activityId:'meal',replacedLabel:'Balanced meal',name:'Fictional lunch',items:[],aiTotals:null,confidence:null,assumptions:[],uncertainties:[],source:'manual',schemaVersion:null,edited:false,photos:[],recordedAt:START,updatedAt:START}];
  expect(gameFrom(s,journeyPlan,START).xp).toBe(20);
  s.activityLogs=journeySnapshot(1).activityLogs.filter(l=>l.activityId==='meal');
  expect(gameFrom(s,journeyPlan,START).xp).toBe(20);
  s.mealLogs=[];s.activityLogs=[];
  expect(gameFrom(s,journeyPlan,START).xp).toBe(0);
});

it('keeps earned goal recognition after natural regression, but reverses deleted source evidence',()=>{
  const s=journeySnapshot(121),date=addDays(START,140);
  s.observations.push(observation('weight',94,date));
  const goal=(snapshot:typeof s)=>gameFrom(snapshot,journeyPlan,date).achievements.find(a=>a.id.includes('weight-goal:goal'));
  expect(goal(s)?.unlocked).toBe(true);
  s.observations=s.observations.filter(o=>!(o.metric==='weight' && o.date===addDays(START,120)));
  expect(goal(s)?.unlocked).toBe(false);
});

it('uses the local calendar day for injury timestamps around midnight',()=>{
  const s=journeySnapshot(1);
  s.activityLogs.push({planId:journeyPlan.id,date:'2026-06-30',activityId:'conditioning',status:'done',count:0,labelSnapshot:'Conditioning',updatedAt:'2026-06-30'});
  s.muscleReports=[{id:'midnight',muscle:'chest',kind:'injured',at:new Date(2026,6,1,0,30).toISOString(),clearedAt:null}];
  expect(gameFrom(s,journeyPlan,'2026-06-30').xp).toBe(20);
  expect(gameFrom(s,journeyPlan,START).quests.some(q=>q.id.endsWith(':strength'))).toBe(false);
});

describe('#176: Quests never fail on stored history', () => {
  // Plans are stored as written, without the schema's defaults. A configuration change keeps the previous plan that way.
  const raw = { format:'pft-plan',formatVersion:7,id:journeyPlan.id,revision:1,title:'Fictional fitness journey', units:{mass:'kg',length:'cm',energy:'kJ'},
    dayTypes:[{id:'regular',label:'Training'}], schedule:{mon:'regular',tue:'regular',wed:'regular',thu:'regular',fri:'regular',sat:'regular',sun:'regular'},
    measurements:[], activities:[{id:'walk',kind:'exercise',purpose:'walking',label:'Comfortable walk'},{id:'strength',kind:'exercise',purpose:'strength',label:'Strength practice'}] };

  it('a previous plan stored without defaults (no `tracking`) is read through the schema: no throw, quests still derived', () => {
    const s = journeySnapshot(3);
    s.configChanges = [{ id: 'c1', appliedAt: `${addDays(START, 10)}T00:00:00Z`, sections: [], payload: {}, fromRevision: 1, toRevision: 2, previousPlanJson: JSON.stringify(raw) } as never];
    let g!: ReturnType<typeof gameFrom>;
    expect(() => { g = gameFrom(s, journeyPlan, addDays(START, 3)); }).not.toThrow();
    expect(g.quests.length).toBeGreaterThan(0);
  });

  it('a malformed or foreign previous plan falls back to the current plan', () => {
    const s = journeySnapshot(2);
    s.configChanges = [
      { id: 'c1', appliedAt: `${addDays(START, 10)}T00:00:00Z`, sections: [], payload: {}, fromRevision: 1, toRevision: 2, previousPlanJson: '{not json' } as never,
    ];
    expect(gameFrom(s, journeyPlan, addDays(START, 2))).toEqual(gameFrom({ ...s, configChanges: [] }, journeyPlan, addDays(START, 2)));
    s.configChanges = [{ ...s.configChanges[0], previousPlanJson: JSON.stringify({ ...raw, id: 'someone-else' }) } as never];
    expect(gameFrom(s, journeyPlan, addDays(START, 2))).toEqual(gameFrom({ ...s, configChanges: [] }, journeyPlan, addDays(START, 2)));
  });

  it('a fresh, empty database gives level 1 with today’s quests', () => {
    const empty = { ...journeySnapshot(0), activityLogs: [], observations: [], quickLogs: [], configChanges: [], daySnapshots: [], mealLogs: [], exerciseLogs: [], muscleReports: [] };
    const g = gameFrom(empty, journeyPlan, START);
    expect(g).toMatchObject({ xp: 0, level: 1 });
    expect(g.quests.length).toBeGreaterThan(0);
  });

  it('an invalid timestamp in history doesn’t break loading', () => {
    const s = journeySnapshot(2);
    s.configChanges = [{ id: 'c1', appliedAt: 'not a date', sections: [], payload: {}, fromRevision: 1, toRevision: 2, previousPlanJson: JSON.stringify(raw) } as never];
    expect(() => gameFrom(s, journeyPlan, addDays(START, 2))).not.toThrow();
  });
});
