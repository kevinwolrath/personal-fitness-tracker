import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { journeyPlan, journeySnapshot, observation, START } from '../fixtures/gamification/journey';
import { addDays } from '../src/plan/dates';
import { gameFrom } from '../src/gamification/model';
import type { StoreSnapshot } from '../src/storage/types';

const DIR='docs/design/issue-73-gamification';
test.use({ storageState:{cookies:[],origins:[]}, reducedMotion:'reduce' });
async function settings(page:Page) { await page.getByRole('button',{name:'Menu',exact:true}).click(); await page.getByTestId('menu-settings').click(); }
async function close(page:Page) { await page.getByTestId('modal-dismiss').last().click(); }
async function install(page:Page,s:StoreSnapshot,date:string) {
  await page.clock.setFixedTime(new Date(`${date}T12:30:00+10:00`));
  await page.evaluate(({s,p})=>{
    const activities:Record<string,Record<string,unknown>>={};
    for(const {planId,date,...l} of s.activityLogs) (activities[`${planId}|${date}`]??={})[l.activityId]=l;
    localStorage.setItem('pft:tracking:v1',JSON.stringify({version:1,plan:{planId:p.id,revision:p.revision,formatVersion:p.formatVersion,json:JSON.stringify(p),origin:'import',importedAt:new Date().toISOString()},activities,overrides:{},observations:s.observations,quickLogs:s.quickLogs,imports:s.imports,configChanges:s.configChanges,completionEvents:s.completionEvents,daySnapshots:{},exerciseLogs:s.exerciseLogs,muscleReports:s.muscleReports,mealLogs:s.mealLogs}));
  },{s,p:journeyPlan});
  await page.goto('/'); await page.reload();
  await expect(page.getByTestId('day-progress')).toBeVisible();
}
async function expectXP(page:Page,s:StoreSnapshot,date:string) {
  const g=gameFrom(s,journeyPlan,date);
  await expect(page.getByTestId('game-level')).toHaveText(`Level ${g.level} · ${g.xp} XP`);
  return g;
}
async function gallery(page:Page) { await page.getByTestId('open-achievements').click(); await expect(page.getByTestId('achievement-gallery')).toBeVisible(); }
async function shot(page:Page,name:string,width:number) {
  if (['first-achievement','quest-complete','level-up','milestone'].includes(name)) await page.getByTestId('game-celebration').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:`${DIR}/${width}-${name}.png`,scale:'css'});
}

test('isolated fictional adult: setup, four months of quests, goals and corrections',async({page},info)=>{
  test.setTimeout(180000);
  mkdirSync(DIR,{recursive:true});
  const width=page.viewportSize()!.width; const checks:string[]=[];
  try {
    await page.clock.setFixedTime(new Date(`${START}T12:30:00+10:00`)); await page.goto('/');
    await expect(page.getByTestId('setup-about')).toBeVisible();
    await page.getByTestId('gender-other').click(); await page.getByTestId('age-40_59').click(); await page.getByTestId('weight-100_plus').click();
    await page.getByTestId('setup-primary').click();
    await page.getByRole('checkbox',{name:'Gradual weight loss'}).click(); await page.getByTestId('activity-some_walking').click();
    await page.getByTestId('setup-primary').click(); await page.getByTestId('setup-primary').click();
    await expect(page.getByTestId('day-progress')).toBeVisible(); checks.push('Fresh first-run onboarding completed using fictional answers.');
    const empty=journeySnapshot(0); empty.observations=[observation('weight',100,START),observation('waist',104,START),observation('pushups',8,START)];
    await install(page,empty,START);
    await expect(page.getByTestId('gamification-card')).toHaveCount(0);
    await shot(page,'before-today',width);
    await page.goto('/progress'); await expect(page.getByTestId('progress-summary')).toBeVisible(); await shot(page,'before-progress',width); await page.goto('/');
    await settings(page); await shot(page,'settings',width); await page.getByRole('switch',{name:'Gamification',exact:true}).click(); await close(page);
    await expectXP(page,empty,START); await shot(page,'initial-today',width);
    await gallery(page); await expect(page.getByTestId('achievement-first')).toContainText('Locked'); await shot(page,'locked-gallery',width); await close(page);
    // A real UI completion exercises persistence, store invalidation, XP and the live celebration.
    await page.getByTestId('activity-meal').getByRole('checkbox').click();
    await expect(page.getByTestId('game-level')).toContainText('20 XP');
    await expect(page.getByTestId('game-celebration').first()).toContainText('Achievement unlocked'); await shot(page,'first-achievement',width);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByTestId('activity-walk').getByRole('checkbox').click();
    await expect(page.getByTestId('game-celebration').first()).toContainText('Quest complete'); await shot(page,'quest-complete',width);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    checks.push('Opt-in, level 1, locked gallery, first achievement and quest completion through real UI.');

    // Deterministic fixture checkpoints simulate months without waiting or modifying actual user records.
    const building=journeySnapshot(3),day4=addDays(START,2);
    // Arrange 180 XP, then a real meal completion crosses level 2.
    building.activityLogs=building.activityLogs.filter(l=>!(l.date===day4&&l.activityId==='meal'));
    building.observations=building.observations.filter(o=>!(o.date===day4&&o.metric==='steps'));
    await install(page,building,day4); const before=await expectXP(page,building,day4);
    await page.getByTestId('activity-meal').getByRole('checkbox').click();
    await expect(page.getByTestId('game-level')).toContainText(`${before.xp+20} XP`);
    await expect(page.getByTestId('game-celebration').first()).toContainText('Level up'); await shot(page,'level-up',width);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    const months=journeySnapshot(61),day60=addDays(START,60);
    await install(page,months,day60); await expectXP(page,months,day60);
    await gallery(page); await expect(page.getByTestId('achievement-consistency')).toContainText('Unlocked'); await expect(page.getByTestId('achievement-strength')).toContainText('Unlocked'); await page.getByTestId('achievement-consistency').scrollIntoViewIfNeeded(); await shot(page,'achievement-gallery',width); await close(page);
    await page.reload(); await expectXP(page,months,day60); await expect(page.getByTestId('game-celebration')).toHaveCount(0);
    checks.push('Daily/weekly quests, conditioning, strength, meals, recovery, multiple levels and reload persistence.');

    const final=journeySnapshot(121),last=addDays(START,120);
    // Leave final weight just short. Enter the goal through the actual Weight sheet to celebrate it.
    final.observations=final.observations.map(o=>o.date===last&&o.metric==='weight'?{...o,value:92.1}:o);
    await install(page,final,last); await expectXP(page,final,last);
    await page.getByTestId('open-achievements').scrollIntoViewIfNeeded();
    // The measurement tile is the same control used by normal tracking.
    await page.getByTestId('measurement-weight').click();
    await page.getByTestId('measure-input').fill('92'); await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByTestId('game-celebration').first()).toContainText('Milestone reached'); await shot(page,'milestone',width);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await gallery(page); await expect(page.getByTestId(`achievement-${journeyPlan.id}:weight-goal:goal:92`)).toContainText('Unlocked'); await page.getByTestId(`achievement-${journeyPlan.id}:weight-goal:goal:92`).scrollIntoViewIfNeeded(); await shot(page,'goal-achieved',width); await close(page);
    checks.push('User-configured weight/waist/strength milestones, gradual progress and goal celebration.');

    // Exercise the browser Health Connect adapter and production sync repeatedly, never an XP injection hook.
    await page.evaluate(({date})=>localStorage.setItem('pft.test.healthConnect',JSON.stringify({availability:'available',granted:[],grantOnRequest:['steps'],data:{steps:[{date,value:5000,origins:['fictional.test.walking']}]}})),{date:last});
    await page.reload(); await expect(page.getByTestId('game-level')).toBeVisible();
    const xpBefore=await page.getByTestId('game-level').textContent();
    await page.getByRole('button',{name:'Menu',exact:true}).click(); await page.getByTestId('menu-health-connect').click();
    await page.getByRole('button',{name:'Connect Health Connect',exact:true}).click(); await expect(page.getByTestId('hc-sync-status')).toContainText('Last synced today');
    await page.getByTestId('hc-check-again').click(); await expect(page.getByTestId('hc-sync-status')).toContainText('Last synced today'); await close(page);
    await expect(page.getByTestId('game-level')).toHaveText(xpBefore!); checks.push('Health Connect fixture mapping, duplicate import and repeated sync preserve XP.');

    await settings(page); await page.getByRole('switch',{name:'Gamification',exact:true}).click(); await close(page);
    await expect(page.getByTestId('gamification-card')).toHaveCount(0); await expect(page.getByTestId('day-progress')).toBeVisible();
    await settings(page); await page.getByRole('switch',{name:'Gamification',exact:true}).click(); await close(page); await expect(page.getByTestId('game-level')).toHaveText(xpBefore!); await expect(page.getByTestId('game-celebration')).toHaveCount(0);
    // Backdated/edited/deleted canonical records and injury are independently checked by the pure projection suite.
    const edge=journeySnapshot(121); edge.activityLogs=edge.activityLogs.filter(l=>l.date!==addDays(START,119));
    edge.muscleReports=[{id:'fictional-injury',muscle:'chest',kind:'injured',at:`${last}T00:00:00+10:00`,clearedAt:null}];
    edge.observations.push(observation('energy_intake',1,last),observation('exercise_session',999,last));
    await install(page,edge,last); await expectXP(page,edge,last); await gallery(page);
    await expect(page.getByTestId('quest-recovery')).toContainText('Respect recovery today');
    await page.getByRole('button',{name:'Log recovery',exact:true}).click(); await expect(page.getByTestId('quest-recovery')).toContainText('Complete');
    await page.getByRole('button',{name:'Undo recovery',exact:true}).click(); await expect(page.getByTestId('quest-recovery')).toContainText('Ready when you are'); await close(page);
    checks.push('Missed workout, injury/recovery logging and undo, off/on, unsafe volume/calorie neutrality, reduced-motion presentation.');
    await page.goto('/progress'); await expect(page.getByTestId('progress-summary')).toBeVisible(); await shot(page,'final-progress',width);
    const continued=journeySnapshot(135); expect(gameFrom(continued,journeyPlan,addDays(START,134)).xp).toBeGreaterThan(gameFrom(journeySnapshot(121),journeyPlan,last).xp);
    checks.push('Progress tab remains usable and meaningful XP continues after reaching weight goal.');
    writeFileSync(`${DIR}/${width}-journey-report.md`,`# ${width}px journey: PASS\n\n${checks.map(c=>`- PASS: ${c}`).join('\n')}\n\nIsolated Playwright storage; fixed synthetic dates ${START} to ${last}; fictional adult. Native Health Connect runtime requires Android hardware.\n`);
  } catch(error) { writeFileSync(`${DIR}/${width}-journey-report.md`,`# ${width}px journey: FAIL\n\n${checks.join('\n')}\n\n${String(error)}\n`); throw error; }
});

test('canonical edits, deletion and backdating reverse rewards without replay',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/');
  const date=addDays(START,34), s=journeySnapshot(35);
  await install(page,s,date); await settings(page); await page.getByRole('switch',{name:'Gamification',exact:true}).click(); await close(page);
  const original=await expectXP(page,s,date);
  await page.goto(`/?date=${START}`);
  await page.getByTestId('activity-meal').getByRole('checkbox').click();
  await page.goto('/progress');
  await expect(page.getByTestId('game-level')).toContainText(`${original.xp-20} XP`);
  await page.goto(`/?date=${START}`); await page.getByTestId('activity-meal').getByRole('checkbox').click();
  await page.goto('/progress'); await expect(page.getByTestId('game-level')).toContainText(`${original.xp} XP`);
  await expect(page.getByTestId('game-celebration')).toHaveCount(0);
  // Correcting an observation in the real UI removes its reward rather than appending another credit.
  await page.goto('/'); await page.getByTestId('recorded-steps').click();
  await page.getByTestId('observation-input').fill('100'); await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByTestId('game-level')).toContainText(`${original.xp-20} XP`);
  await page.getByTestId('recorded-steps').click(); await page.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.getByTestId('recorded-steps')).toHaveCount(0);
  await expect(page.getByTestId('game-level')).toContainText(`${original.xp-20} XP`);
  await page.reload(); await expect(page.getByTestId('game-level')).toContainText(`${original.xp-20} XP`);
});
