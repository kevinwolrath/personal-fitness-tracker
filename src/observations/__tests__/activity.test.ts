import { activitySummary, isWalk } from '../activity';
import { mapHealthConnect, sessionDistance, type HcRead, type HcSession } from '../healthConnect';
import { formatDistance, formatMinutes } from '../units';
import { dailySeries } from '../../progress/series';
import fixture from '../../../e2e/fixtures/walking-health-connect.json';

const mapped=()=>mapHealthConnect(fixture.data as HcRead,['2026-11-02'],'2026-11-02T12:00:00+11:00',iso=>iso.slice(0,10)).observations;
test('duration and distance units are explicit at boundaries',()=>{
 expect([0,45,60,119.6,465].map(formatMinutes)).toEqual(['0 min','45 min','1 hr','2 hr','7 hr 45 min']);
 expect([0,850,1250].map(formatDistance)).toEqual(['0 m','850 m','1.25 km']);
});
test('four source records survive mapping, union time and conservative distance avoid inflated totals',()=>{
 const walks=mapped().filter(isWalk),s=activitySummary(walks);
 expect(walks).toHaveLength(4);expect(s.minutes).toBe(105);expect(s.unique).toHaveLength(3);expect(s.duplicates.size).toBe(1);expect(s.metres).toBe(4800);expect(s.partialDistance).toBe(true);expect(s.overlap).toBe(true);
 expect(dailySeries(walks,'exercise_session','sum')[0].value).toBe(105);
});
test('absent distance stays absent; unknown timings are a lower bound, not assumed unique totals',()=>{
 const walks=mapped().filter(isWalk).map(o=>({...o,activity:undefined,source:{...o.source,capturedAt:null}}));
 const s=activitySummary(walks);expect(s.metres).toBeNull();expect(s.minutes).toBe(45);expect(s.uncertainTime).toBe(true);
 const one={...mapped().filter(isWalk)[0],activity:undefined};expect(activitySummary([one]).minutes).toBe(45);
});
test('exact source duplicates do not multiply minutes or distance; different known activity types remain distinct',()=>{
 const a=mapped().filter(isWalk)[0];const b={...a,id:'duplicate',source:{...a.source,app:'google-fit'}};
 expect(activitySummary([a,b,a])).toMatchObject({minutes:45,metres:3000});expect(activitySummary([a,b]).unique).toHaveLength(1);
 expect(activitySummary([a,{...b,activity:{...b.activity!,exerciseType:56}}]).unique).toHaveLength(2);
});
test('distance must come from same source and wholly contained records; no proportional allocation',()=>{
 const session=(fixture.data.exercise[0] as HcSession);
 expect(sessionDistance(session,[{id:'daily',origin:session.origin,start:'2026-11-02T00:00:00+11:00',end:'2026-11-03T00:00:00+11:00',metres:10000}])).toEqual({});
 expect(sessionDistance(session,[{id:'other',origin:'other',start:session.start,end:session.end,metres:3000}])).toEqual({});
 expect(sessionDistance({...session,origin:''},[{id:'unknown',origin:'',start:session.start,end:session.end,metres:3000}])).toEqual({});
 expect(sessionDistance(session,[{id:'valid',origin:session.origin,start:session.start,end:session.end,metres:3000},{id:'duplicate',origin:session.origin,start:session.start,end:session.end,metres:3000}]).distanceMeters).toBe(3000);
 expect(sessionDistance(session,[{id:'partial',origin:session.origin,start:session.start,end:'2026-11-02T08:20:00+11:00',metres:1200}])).toEqual({distanceMeters:1200,distancePartial:true});
});
