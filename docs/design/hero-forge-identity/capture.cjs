// Offline proposal renderer; serves only for the duration of this process.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../../..');
const out = path.join(__dirname, 'screenshots');
const types = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
fs.mkdirSync(out,{recursive:true});
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const isApp = url.pathname.startsWith('/app');
  const base = isApp ? path.join(root,'dist') : root;
  let rel = isApp ? url.pathname.slice(4) : url.pathname;
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let file = path.resolve(base,'.'+rel);
  if (!file.startsWith(base+path.sep)) {res.writeHead(403);return res.end();}
  if(!fs.existsSync(file)) file=isApp?path.join(base,'index.html'):'';
  if(!file){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
async function main(){
 await new Promise(r=>server.listen(8096,'127.0.0.1',r));
 const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const base='http://127.0.0.1:8096/docs/design/hero-forge-identity/';
  const checks=[];
  for(const direction of ['forged','rails']){
   for(const screen of ['today','progress','workout','guide','settings']){
    await page.goto(`${base}?direction=${direction}&screen=${screen}`);
    await page.locator('main').waitFor();
    await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    await page.screenshot({path:path.join(out,`${direction}-${screen}.png`)});
    for(const width of [360,390,430]){
     await page.setViewportSize({width,height:844});
     const result=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>innerWidth,
      badTargets:[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width<47.9||r.height<47.9}).map(e=>e.getAttribute('aria-label')),
      brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,
      mainStart:document.querySelector('.next-action')?.getBoundingClientRect().top,
      workoutHeight:document.querySelector('.compact-workout')?.getBoundingClientRect().height,
      scrollable:document.querySelector('.scroll').scrollHeight>document.querySelector('.scroll').clientHeight,
     }));
     const reachability=await page.evaluate(()=>{
      const main=document.querySelector('.scroll');const header=document.querySelector('.sheet-head');
      const before=header?.getBoundingClientRect().top;
      main.scrollTop=main.scrollHeight;
      const reached=Math.abs(main.scrollHeight-main.clientHeight-main.scrollTop)<2;
      const fixedHeader=!header||header.getBoundingClientRect().top===before;
      const last=main.lastElementChild.getBoundingClientRect();
      const bottomReachable=last.bottom<=main.getBoundingClientRect().bottom+1;
      main.scrollTop=0;
      return {reachedBottom:reached,fixedHeader,bottomReachable};
     });
     checks.push({direction,screen,width,...result,...reachability});
    }
    await page.setViewportSize({width:390,height:844});
   }
   await page.setViewportSize({width:2140,height:1100});
   await page.goto(`${base}?direction=${direction}`);
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   await page.screenshot({path:path.join(out,`${direction}-overview.png`),fullPage:true});
   await page.setViewportSize({width:390,height:844});
  }
  await page.setViewportSize({width:1180,height:1000});
  await page.goto(`${base}?screen=icons`);
  await page.screenshot({path:path.join(out,'icon-family.png'),fullPage:true});
  fs.writeFileSync(path.join(__dirname,'render-checks.json'),JSON.stringify(checks,null,2)+'\n');
  if(checks.some(c=>c.overflow||c.badTargets.length||c.brokenImages||!c.reachedBottom||!c.fixedHeader||!c.bottomReachable||(c.mainStart && c.mainStart>200)||(c.workoutHeight && c.workoutHeight>200))) throw Error('Proposal geometry check failed; see render-checks.json');
  console.log(`PASS: ${checks.length} viewport/surface checks; 10 phones, 2 overviews, icon sheet rendered.`);
 }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1});
