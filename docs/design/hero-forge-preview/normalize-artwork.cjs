/** Uniform framing only, after genuine AI pose correction. Raw AI PNGs remain untouched. */
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const dir=__dirname;
async function main(){
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  const manifest={canvas:[1024,1536],targetTop:40,targetBottom:1472,method:'Uniform resampling and translation for common framing only. No pose, perspective, mirroring, asymmetric scaling or anatomical edits. Raw AI outputs retained.',images:{}};
  for(const character of ['male','female','neutral']) for(const view of ['front','back']){
   const id=character+'-'+view;
   const src='data:image/png;base64,'+fs.readFileSync(path.join(dir,'artwork/raw',id+'.png')).toString('base64');
   const result=await page.evaluate(async(src)=>{
    const im=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src});
    if(im.width!==1024||im.height!==1536)throw new Error('Unexpected AI canvas '+im.width+'x'+im.height);
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1536;
    const c=canvas.getContext('2d');c.drawImage(im,0,0);
    const p=c.getImageData(0,0,1024,1536).data;
    let top=1536,bottom=0,left=1024,right=0;
    // Bright rim/armour/hair pixels establish bounds; background is dark and has no scene.
    for(let y=0;y<1536;y++)for(let x=0;x<1024;x++){
     const k=(y*1024+x)*4;
     if(Math.max(p[k],p[k+1],p[k+2])>85&&p[k]+p[k+1]+p[k+2]>180){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}
    }
    const scale=(1472-40)/(bottom-top),tx=512-(left+right)/2*scale,ty=40-top*scale;
    c.fillStyle='#101519';c.fillRect(0,0,1024,1536);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    c.drawImage(im,tx,ty,1024*scale,1536*scale);
    return {png:canvas.toDataURL('image/png'),sourceBounds:{left,top,right,bottom},scale,tx,ty};
   },src);
   fs.writeFileSync(path.join(dir,'artwork',id+'.png'),Buffer.from(result.png.split(',')[1],'base64'));
   delete result.png;manifest.images[id]=result;
  }
  fs.writeFileSync(path.join(dir,'artwork/framing.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
