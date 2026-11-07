const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const raw=require('./contours.cjs');
const framing=require('./artwork/framing.json');
const inventory=require('../../../src/exercises/inventory.json');
const palette={priority:'#ffbd72',activated:'#78c9df',sore:'#f0c46a',injured:'#ff9c9c'};
const regionColours=['#f6ad78','#bdb0ed','#86c7eb','#ffd078','#dc9d86','#ecb58a','#84d1d0','#a9ce89','#b7b1dc','#83b9e6','#78c6be','#d6b7e0','#a7b9f0','#e6c28a'];
const regions={};
function transformPath(d,f){
 let i=0;
 return d.replace(/-?\d+(?:\.\d+)?/g,n=>{const v=Number(n)*f.scale+(i++%2===0?f.tx:f.ty);return v.toFixed(2)});
}
for(const [c,views]of Object.entries(raw)){
 regions[c]={};
 for(const [v,groups]of Object.entries(views)){
  regions[c][v]=Object.fromEntries(Object.entries(groups).map(([id,ds])=>[id,ds.map(d=>transformPath(d,framing.images[c+'-'+v]))]));
 }
}
let instance=0;
function art(c,v,selection='',state='priority',annotate=false,standalone=false,viewBox){
 viewBox=viewBox||(standalone?'0 0 1024 1536':'180 0 664 1536');
 const key=`hf-${++instance}`;
 const src=standalone?`../artwork/${c}-${v}.png`:`artwork/${c}-${v}.png`;
 const states=Object.entries(regions[c][v]).map(([id,ds])=>{
  const index=inventory.muscleGroups.findIndex(m=>m.id===id);
  const on=selection===id||selection==='all';
  const color=annotate?regionColours[index]:palette[state];
  const fill=annotate?color:state==='sore'||state==='injured'?`url(#${key}-${state})`:color;
  const alpha=annotate?'.22':on?state==='priority'?'.04':'.58':'0';
  const numbers=ds[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs=numbers.filter((_,i)=>i%2===0),ys=numbers.filter((_,i)=>i%2===1);
  const x=(Math.min(...xs)+Math.max(...xs))/2,y=(Math.min(...ys)+Math.max(...ys))/2;
  return `<g data-muscle="${id}" data-highlight="${on}" role="img" aria-label="${inventory.muscleGroups[index].label}, ${v}"><title>${inventory.muscleGroups[index].label}</title><path d="${ds.join(' ')}" fill="${fill}" fill-opacity="${alpha}" stroke="${on||annotate?color:'none'}" stroke-width="${on?5:annotate?2:0}" pointer-events="all" vector-effect="none"/>${annotate?`<circle cx="${x}" cy="${y}" r="14" fill="#101519" stroke="${color}" stroke-width="2"/><text x="${x}" y="${y+5}" fill="#fff" text-anchor="middle" font-size="15" font-family="Arial" pointer-events="none">${index+1}</text>`:''}</g>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" data-character="${c}" data-view="${v}" class="character-art" role="group" aria-label="${c}, ${v} view; muscle-region visual review"><defs><pattern id="${key}-sore" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M-3 3L3 -3M0 18L18 0M15 21L21 15" stroke="${palette.sore}" stroke-width="6"/></pattern><pattern id="${key}-injured" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M0 0L20 20M20 0L0 20" stroke="${palette.injured}" stroke-width="5"/></pattern></defs><image href="${src}" width="1024" height="1536"/>${states}</svg>`;
}
function writeAssets(){
 const out=path.join(__dirname,'overlays');fs.mkdirSync(out,{recursive:true});
 const meta={version:2,status:'visual-approval-only',viewBox:[0,0,1024,1536],coordinateSpace:'Final normalized PNG pixels; raw contours transformed once with artwork/framing.json',regions};
 fs.writeFileSync(path.join(out,'muscle-regions.json'),JSON.stringify(meta,null,2)+'\n');
 for(const c of Object.keys(regions))for(const v of ['front','back']){
  const groups=Object.entries(regions[c][v]).map(([id,ds])=>`<g id="${id}" data-muscle="${id}"><title>${inventory.muscleGroups.find(m=>m.id===id).label}</title>${ds.map(d=>`<path d="${d}"/>`).join('')}</g>`).join('');
  fs.writeFileSync(path.join(out,`${c}-${v}-regions.svg`),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536">${groups}</svg>\n`);
  fs.writeFileSync(path.join(out,`${c}-${v}-review.svg`),art(c,v,'all','activated',true,true)+'\n');
 }
 const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'artwork',name+'.png'))).digest('hex');
 fs.writeFileSync(path.join(out,'artwork-bindings.json'),JSON.stringify({viewBox:meta.viewBox,files:Object.fromEntries(Object.keys(regions).flatMap(c=>['front','back'].map(v=>[`${c}-${v}`,{png:`../artwork/${c}-${v}.png`,sha256:hash(`${c}-${v}`),regions:`${c}-${v}-regions.svg`}])) )},null,2)+'\n');
}
module.exports={art,regions,writeAssets};
