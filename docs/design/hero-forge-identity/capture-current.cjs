const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'../../..');
const dist=path.join(root,'dist');
const out=path.join(__dirname,'screenshots');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{
 let file=path.resolve(dist,'.'+new URL(req.url,'http://x').pathname);
 if(file!==dist&&!file.startsWith(dist+path.sep)){res.writeHead(403);return res.end();}
 if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
async function run(){
 await new Promise(r=>server.listen(8097,'127.0.0.1',r));
 const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']});
 try{
  const seedJson=fs.readFileSync(path.join(root,'plans/seed.plan.json'),'utf8');const seed=JSON.parse(seedJson);
  const store={version:1,plan:{planId:seed.id,revision:seed.revision,formatVersion:seed.formatVersion,json:seedJson,importedAt:'2026-11-01T00:00:00.000Z',origin:'seed'},activities:{},overrides:{},observations:[],quickLogs:[],imports:[],configChanges:[],completionEvents:[],daySnapshots:{}};
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'en-AU',timezoneId:'Australia/Sydney',storageState:{cookies:[],origins:[{origin:'http://127.0.0.1:8097',localStorage:[{name:'pft:tracking:v1',value:JSON.stringify(store)},{name:'pft.display.theme',value:'hero-forge'}]}]}});
  const page=await context.newPage();await page.clock.setFixedTime(new Date('2026-11-02T09:00:00+11:00'));
  await page.goto('http://127.0.0.1:8097');
  await page.getByTestId('today-workout-show-all').waitFor({timeout:60000});await page.waitForTimeout(500);
  const capture=async name=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`current-${name}.png`)});fs.writeFileSync(path.join(out,`current-${name}.txt`),await page.locator('body').innerText());};
  await capture('today');
  await page.getByTestId('today-workout-show-all').click();await page.getByTestId('today-workout-sheet').waitFor();await capture('workout');
  await page.getByTestId('today-workout-sheet').getByRole('button',{name:'Goblet squat. Show how',exact:true}).click();await page.getByTestId('exercise-guide').waitFor();await capture('guide');
  await page.getByRole('button',{name:'Close guide',exact:true}).click();await page.getByRole('button',{name:"Close today's workout",exact:true}).click();
  await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByTestId('menu-settings').click();await page.getByTestId('settings-sheet').waitFor();await capture('settings');
  await page.goto('http://127.0.0.1:8097/progress');await page.getByTestId('chart-weight').waitFor();await capture('progress');
  console.log('Captured five current app surfaces using unchanged export and repository seed plan with empty history.');
 }finally{await browser.close();server.close();}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1});
