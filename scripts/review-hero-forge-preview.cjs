/** Render and inspect approval artifacts; this is not a production feature test. */
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'docs/design/hero-forge-preview');
const inventory = require('../src/exercises/inventory.json');
const { regions } = require('../docs/design/hero-forge-preview/overlays/muscle-regions.json');
async function main() {
  const ids = inventory.muscleGroups.map(m=>m.id).sort();
  const bindings=require('../docs/design/hero-forge-preview/overlays/artwork-bindings.json');
  for(const [id,binding]of Object.entries(bindings.files)){
    const png=fs.readFileSync(path.join(dir,'artwork',id+'.png'));
    if(png.readUInt32BE(16)!==1024||png.readUInt32BE(20)!==1536)throw new Error(`${id}: incorrect canvas`);
    if(crypto.createHash('sha256').update(png).digest('hex')!==binding.sha256)throw new Error(`${id}: artwork differs from overlay binding`);
  }
  for (const [c, views] of Object.entries(regions)) {
    const actual = [...new Set(Object.values(views).flatMap(v=>Object.keys(v)))].sort();
    if (JSON.stringify(ids)!==JSON.stringify(actual)) throw new Error(`${c}: muscle IDs differ from inventory`);
    for (const [view, groups] of Object.entries(views)) {
      for (const [id, paths] of Object.entries(groups)) {
        if (!paths.length || paths.some(d=>!d.startsWith('M') || !d.endsWith('Z'))) throw new Error(`${c}/${view}/${id}: invalid path`);
      }
    }
    for (const id of ['upper_back','lats','lower_back','triceps','glutes','hamstrings','calves']) {
      if (views.front[id]) throw new Error(`${c}: rear-only region ${id} on front`);
    }
  }
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
    await page.evaluate(()=>document.fonts.ready);
    const loaded=await page.evaluate(async()=>{
      const urls=[...new Set([...document.querySelectorAll('svg image')].map(i=>i.getAttribute('href')))];
      return Promise.all(urls.map(src=>new Promise(resolve=>{const im=new Image();im.onload=()=>resolve({src,ok:im.naturalWidth>0});im.onerror=()=>resolve({src,ok:false});im.src=src})));
    });
    if(loaded.some(r=>!r.ok))throw new Error('Artwork failed to load: '+JSON.stringify(loaded.filter(r=>!r.ok)));
    const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src));
    if(broken.length) throw new Error('Broken reference images: '+broken.join(', '));
    for (const id of ['today','progress','workout','muscle-map','coming-soon','contact-sheet','mapping-sheet']) {
      await page.locator('#'+id).screenshot({path:path.join(dir,id+'-v2.png')});
    }
    await page.evaluate(()=>{
      const group=document.createElement('div');
      group.id='three-screen-review';
      group.style.cssText='display:flex;gap:20px;padding:20px;background:#090d10;width:max-content';
      for(const id of ['today','progress','workout']) group.appendChild(document.querySelector('#'+id).cloneNode(true));
      document.body.appendChild(group);
    });
    await page.locator('#three-screen-review').screenshot({path:path.join(dir,'three-screen-review-v2.png')});
    await page.locator('#three-screen-review').evaluate(el=>el.remove());
    for(const c of Object.keys(regions)){
      for(const v of ['front','back'])await page.locator(`#compare-${c}-${v}`).screenshot({path:path.join(dir,`before-after-${c}-${v}.png`)});
      for(const part of ['chest','shoulders','upper_back','hips'])await page.locator(`#closeup-${c}-${part}`).screenshot({path:path.join(dir,`closeup-${c}-${part}.png`)});
      await page.selectOption('#isolation-character',c);
      await page.setViewportSize({width:1280,height:1800});
      await page.locator('#isolation-sheet').screenshot({path:path.join(dir,`isolated-regions-${c}.png`)});
      await page.setViewportSize({width:1280,height:1000});
    }
    let samples=0;
    for(const c of Object.keys(regions)) {
      await page.selectOption('#character',c);
      for(const m of inventory.muscleGroups) {
        await page.selectOption('#muscle',m.id);
        for(const state of ['priority','activated','sore','injured']) {
          await page.selectOption('#treatment',state);
          const visible=await page.locator('#demo-art g[data-highlight="true"]').count();
          const expected=['front','back'].filter(v=>regions[c][v][m.id]).length;
          if(visible!==expected)throw new Error(`${c}/${m.id}/${state}: expected ${expected} highlighted paths, got ${visible}`);
          samples++;
        }
      }
    }
    await page.selectOption('#character','neutral');
    await page.selectOption('#muscle','lats');
    await page.selectOption('#treatment','activated');
    await page.locator('#highlight-demo').screenshot({path:path.join(dir,'highlight-demo-v2.png')});
    // One view of all four treatments, each is explicitly a visual sample rather than tracked history.
    await page.selectOption('#muscle','quadriceps');
    for(const state of ['priority','activated','sore','injured']) {
      await page.selectOption('#treatment',state);
      await page.locator('#highlight-demo').screenshot({path:path.join(dir,'highlight-'+state+'-v2.png')});
    }
    const widths=[];
    let alignmentChecks=0;
    for(const width of [360,390,430]) {
      await page.setViewportSize({width,height:844});
      for(const id of ['today','progress','workout','muscle-map','coming-soon']) {
        const bad=await page.locator('#'+id).evaluate(el=>({width:el.clientWidth,overflow:el.scrollWidth>el.clientWidth,inner:[...el.querySelectorAll('.phone-scroll')].some(x=>x.scrollWidth>x.clientWidth)}));
        if(bad.overflow||bad.inner)throw new Error(`${id} overflows at ${width}`);
      }
      for(const c of Object.keys(regions)){
        await page.selectOption('#character',c);
        for(const m of inventory.muscleGroups){
          await page.selectOption('#muscle',m.id);
          const valid=await page.locator('#demo-art').evaluate(el=>[...el.querySelectorAll('svg')].every(svg=>{
            const image=svg.querySelector('image');
            const a=image.getScreenCTM();
            return svg.getAttribute('preserveAspectRatio')==='xMidYMid meet'&&[...svg.querySelectorAll('[data-muscle] path')].every(p=>{
              const b=p.getScreenCTM();
              return ['a','b','c','d','e','f'].every(k=>Math.abs(a[k]-b[k])<.001);
            });
          }));
          if(!valid)throw new Error(`${c}/${m.id}: overlay/image coordinate mismatch at ${width}`);
          alignmentChecks++;
        }
        await page.selectOption('#muscle','chest');
        await page.selectOption('#treatment','activated');
        await page.locator('#highlight-demo').screenshot({path:path.join(dir,`mobile-${width}-${c}-chest.png`)});
        await page.selectOption('#muscle','upper_back');
        await page.locator('#highlight-demo').screenshot({path:path.join(dir,`mobile-${width}-${c}-upper-back.png`)});
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(overflow)throw new Error(`Approval page overflows at ${width}`);
      widths.push(width);
    }
    await page.selectOption('#character','male');
    await page.selectOption('#muscle','core');
    const chest=page.locator('#demo-art svg[data-view="front"] g[data-muscle="chest"]');
    await chest.focus();await page.keyboard.press('Enter');
    if(await page.locator('#muscle').inputValue()!=='chest')throw new Error('Keyboard region selection failed');
    await page.selectOption('#treatment','sore');
    const sore=await page.locator('#demo-art g[data-highlight="true"] path').first().getAttribute('fill');
    await page.selectOption('#treatment','injured');
    const injured=await page.locator('#demo-art g[data-highlight="true"] path').first().getAttribute('fill');
    if(sore===injured||!sore.includes('sore')||!injured.includes('injured'))throw new Error('Symptom patterns are indistinguishable');
    if(errors.length)throw new Error(errors.join('\n'));
    const result={status:'passed',scope:'Approval artifacts only; app unchanged; automated checks are not proof of anatomical accuracy',muscleGroups:ids.length,characters:Object.keys(regions),artworkBindings:6,canvas:'1024x1536',highlightSamples:samples,mobileWidths:widths,alignmentChecks,keyboardRegionSelection:'passed',symptomPatterns:'diagonal sore / cross-hatch injured',referenceImages:'all loaded',svgImageSources:loaded.length,browserErrors:errors};
    fs.writeFileSync(path.join(dir,'review-results.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
