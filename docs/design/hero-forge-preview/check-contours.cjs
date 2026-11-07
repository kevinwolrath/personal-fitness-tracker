/** Geometry diagnostics support visual review. They do not validate anatomy. */
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {regions}=require('./overlays/muscle-regions.json');
async function main(){
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const results=[];
  for(const c of Object.keys(regions))for(const v of ['front','back']){
   const source='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'artwork',`${c}-${v}.png`)).toString('base64');
   const r=await page.evaluate(async({groups,source})=>{
    const im=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=source});
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;const ctx=canvas.getContext('2d');
    ctx.drawImage(im,0,0,512,768);const art=ctx.getImageData(0,0,512,768).data;
    // Edge-connected dark pixels identify the scene background, rather than mistaking
    // enclosed dark armour plates for empty space. This remains a diagnostic heuristic.
    const background=new Uint8Array(512*768),queue=[];
    const eligible=p=>{const k=p*4;return Math.max(art[k],art[k+1],art[k+2])<=38&&Math.abs(art[k]-16)<=14&&Math.abs(art[k+1]-21)<=14&&Math.abs(art[k+2]-25)<=14};
    const add=p=>{if(p>=0&&p<background.length&&!background[p]&&eligible(p)){background[p]=1;queue.push(p)}};
    for(let x=0;x<512;x++){add(x);add(767*512+x)}
    for(let y=0;y<768;y++){add(y*512);add(y*512+511)}
    for(let q=0;q<queue.length;q++){const p=queue[q],x=p%512;add(p-512);add(p+512);if(x>0)add(p-1);if(x<511)add(p+1)}
    const owner=new Uint8Array(512*768),pairs={},outside={};let n=0,total=0;
    for(const [id,ds]of Object.entries(groups)){
     n++;ctx.clearRect(0,0,512,768);ctx.save();ctx.scale(.5,.5);ctx.fillStyle='#fff';ctx.fill(new Path2D(ds.join(' ')));ctx.restore();
     const pixels=ctx.getImageData(0,0,512,768).data;let count=0,stray=0;
     for(let y=0;y<768;y++)for(let x=0;x<512;x++){
      const p=y*512+x;if(pixels[p*4+3]<240)continue;count++;total++;
      if(owner[p]){const key=Object.keys(groups)[owner[p]-1]+' / '+id;pairs[key]=(pairs[key]||0)+1;}owner[p]=n;
      let subject=!background[p];
      for(let dy=-2;dy<=2&&!subject;dy++)for(let dx=-2;dx<=2&&!subject;dx++){
       const k=(y+dy)*512+x+dx;
       if(k>=0&&k<background.length&&!background[k])subject=true;
      }
      if(!subject)stray++;
     }
     if(stray)outside[id]={suspectPixels:stray,regionPixels:count,percent:Number((stray/count*100).toFixed(2))};
    }
    return{overlapPixelsByPair:pairs,backgroundSuspects:outside,totalRegionPixels:total};
   },{groups:regions[c][v],source});
   results.push({character:c,view:v,...r});
  }
  fs.writeFileSync(path.join(__dirname,'contour-diagnostics.json'),JSON.stringify({note:'Raster diagnostics only; dark armour may produce false background suspects. Not proof of anatomical accuracy.',results},null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
  if(results.some(r=>Object.keys(r.overlapPixelsByPair).length))throw new Error('Cross-group filled-region intersection detected; inspect contours before approval');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
