const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const dir=path.resolve('docs/design/hero-forge-preview');
 const browser=await chromium.launch();
 try {
 const page=await browser.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:1});
 const data=name=>'data:image/png;base64,'+fs.readFileSync(path.join(dir,name)).toString('base64');
 const original=data('male-front-poc-original-sheet.png');
 const generated=data('male-front-regenerated-poc.png');
 await page.setContent('<canvas width="1100" height="1000"></canvas>');
 const url=await page.evaluate(async({original,generated})=>{
 const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
 const [a,b]=await Promise.all([load(original),load(generated)]);
 const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
 c.fillStyle='#101519';c.fillRect(0,0,1100,1000);
 c.fillStyle='#f1f3f4';c.font='bold 26px Arial';c.fillText('Male front view · perspective correction proof of concept',32,45);
 c.font='16px Arial';c.fillStyle='#b5bdc4';c.fillText('Original approved artwork versus genuine AI reference-image edit · awaiting visual approval',32,76);
 c.fillStyle='#ff9e42';c.font='bold 20px Arial';c.fillText('ORIGINAL · approved ZIP',70,121);c.fillText('REGENERATED · AI edit',610,121);
 // Presentation only: crop original male from unmodified sheet, preserving aspect ratio.
 // Generated output is displayed intact with uniform scaling. No pose correction is performed here.
 const sx=22,sy=215,sw=253,sh=650;
 const height=780,ow=sw*height/sh;
 c.drawImage(a,sx,sy,sw,sh,275-ow/2,145,ow,height);
 const gh=780,gw=b.width*gh/b.height;
 c.drawImage(b,825-gw/2,145,gw,gh);
 c.strokeStyle='#53616b';c.beginPath();c.moveTo(550,110);c.lineTo(550,935);c.stroke();
 c.fillStyle='#b5bdc4';c.font='14px Arial';c.fillText('Left: unchanged source pixels, cropped for comparison only.',32,967);
 c.fillText('Right: image_gen reference edit; no geometric correction or post-processing.',570,967);
 return canvas.toDataURL('image/png');
 },{original,generated});
 fs.writeFileSync(path.join(dir,'male-front-original-vs-regenerated-poc.png'),Buffer.from(url.split(',')[1],'base64'));
 console.log('Saved comparison PNG. Generated image remains unchanged.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
