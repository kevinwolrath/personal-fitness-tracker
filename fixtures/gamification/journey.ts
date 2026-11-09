import { planSchema } from '../../src/plan/schema';
import { addDays, weekdayOf } from '../../src/plan/dates';
import { manualSource, type Observation } from '../../src/observations/types';
import type { StoreSnapshot } from '../../src/storage/types';

/** Fictional adult, user-selected goals. Never reads files or a real user's data. */
export const journeyPlan = planSchema.parse({ format:'pft-plan',formatVersion:7,id:'fictional-forge',revision:1,title:'Fictional fitness journey', units:{mass:'kg',length:'cm',energy:'kJ'}, dayTypes:[{id:'regular',label:'Training'},{id:'rest',label:'Recovery'}], schedule:{mon:'regular',tue:'regular',wed:'regular',thu:'regular',fri:'regular',sat:'regular',sun:'rest'}, measurements:[{id:'weight',label:'Weight',quantity:'mass',cadence:{every:'day'}},{id:'waist',label:'Waist',quantity:'length',cadence:{every:'week',on:'sun'}},{id:'pushups',label:'Push-up capability',quantity:'number',unitLabel:'reps',cadence:{every:'week',on:'sun'}}], goals:[{id:'weight-goal',label:'My weight goal',measurementId:'weight',target:92,direction:'decrease'},{id:'waist-goal',label:'My waist goal',measurementId:'waist',target:96,direction:'decrease'},{id:'strength-goal',label:'My strength goal',measurementId:'pushups',target:12,direction:'increase'}], activities:[{id:'walk',kind:'exercise',purpose:'walking',label:'Comfortable walk',duration:{minutes:20},tracking:{type:'check'}},{id:'strength',kind:'exercise',purpose:'strength',label:'Strength practice',appliesTo:{days:['mon','wed','fri']},tracking:{type:'check'}},{id:'conditioning',kind:'exercise',purpose:'conditioning_low_intensity',label:'Easy conditioning',appliesTo:{days:['tue','thu']},tracking:{type:'check'}},{id:'meal',kind:'meal',purpose:'nutrition',label:'Balanced meal',time:'12:00',tracking:{type:'check'}}], exercise:{restDays:['sun']} });
export const START = '2026-07-01';
export function observation(metric:string,value:number,date:string,id=`${metric}-${date}`): Observation {
  return {id,metric,value,date,unit:metric==='weight'?'kg':metric==='waist'?'cm':'count',kind:'observed',source:manualSource(),label:null,note:null,recordedAt:new Date(`${date}T09:00:00+10:00`).toISOString()};
}
export function journeySnapshot(days:number): StoreSnapshot {
  const s:StoreSnapshot={plans:[],activityLogs:[],observations:[],dayOverrides:[],quickLogs:[],imports:[],configChanges:[],completionEvents:[],daySnapshots:[],exerciseLogs:[],muscleReports:[],mealLogs:[]};
  for(let i=0;i<days;i++) {
    const date=addDays(START,i), weekday=weekdayOf(date), fraction=Math.min(i/120,1);
    s.observations.push(observation('steps',5000,date));
    if(i%7===0 || i===120) s.observations.push(observation('weight',100-8*fraction,date),observation('waist',104-8*fraction,date),observation('pushups',8+4*fraction,date));
    const ids=['meal',...(['mon','wed','fri'].includes(weekday)?['strength']:[]),...(['tue','thu'].includes(weekday)?['conditioning']:[])];
    for(const activityId of ids) s.activityLogs.push({planId:journeyPlan.id,date,activityId,status:'done',count:0,labelSnapshot:activityId,updatedAt:`${date}T18:00:00+10:00`});
    if(weekday==='sun') s.quickLogs.push({id:`rest-${date}`,planId:journeyPlan.id,date,quickLogId:'gamification-recovery',at:`${date}T18:00:00+10:00`});
    if(i%14===0) s.exerciseLogs!.push({id:`capability-${date}`,movement:'push_up',date,at:`${date}T09:00:00+10:00`,sets:1,reps:Math.round(8+4*fraction),seconds:null,intensity:'moderate'});
  }
  return s;
}
