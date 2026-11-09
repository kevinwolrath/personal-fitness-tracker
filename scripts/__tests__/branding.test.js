const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {approvedBranding}=require('../branding.cjs');
const {pngInfo}=require('../play-listing');
const config=require('../../app.json').expo;

test('approved masters and generated store exports validate; app identities and permission scope stay intact',()=>{
  const branding=approvedBranding();
  expect(Object.keys(branding.manifest.sources)).toHaveLength(3);
  expect(pngInfo(branding.read('store-icon-512.png'))).toMatchObject({width:512,height:512,color:6});
  expect(pngInfo(branding.read('feature-graphic.png'))).toMatchObject({width:1024,height:500,color:2});
  expect(config.android.package).toBe('com.questspire.personalfitnesstracker');
  expect(config.ios.bundleIdentifier).toBe(config.android.package);
  expect(config.android.permissions).toEqual(['android.permission.health.READ_STEPS','android.permission.health.READ_ACTIVE_CALORIES_BURNED','android.permission.health.READ_EXERCISE','android.permission.health.READ_WEIGHT','android.permission.health.READ_BODY_FAT','android.permission.health.READ_SLEEP']);
  for(const file of [config.icon,config.ios.icon,config.web.favicon,config.android.adaptiveIcon.foregroundImage,config.android.adaptiveIcon.monochromeImage]) expect(fs.existsSync(path.resolve(__dirname,'../..',file))).toBe(true);
  expect(config.android.adaptiveIcon.backgroundColor).toBe(branding.manifest.background);
});
test('preparation refuses changed master or stale derivative instead of silently replacing approved artwork',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'body-anvil-branding-'));
  try{
    fs.cpSync(path.resolve(__dirname,'../../assets/branding'),path.join(dir,'assets/branding'),{recursive:true});
    fs.appendFileSync(path.join(dir,'assets/branding/generated/store-icon-512.png'),'changed');
    expect(()=>approvedBranding(dir).read('store-icon-512.png')).toThrow('Branding export changed');
    fs.appendFileSync(path.join(dir,'assets/branding/body-anvil-approved-heroes.png'),'changed');
    expect(()=>approvedBranding(dir)).toThrow('Approved master changed');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('splash and notifications point to dedicated exports, not opaque launcher fallbacks',()=>{
  const splash=config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-splash-screen')[1];
  const notifications=config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-notifications')[1];
  expect(splash.backgroundColor).toBe('#000000');expect(splash.resizeMode).toBe('contain');
  expect(splash.image).toContain('splash-heroes.png');expect(splash.dark.backgroundColor).toBe(splash.backgroundColor);
  expect(notifications.icon).toContain('notification-small.png');
  expect(pngInfo(approvedBranding().read('notification-small.png'))).toMatchObject({width:96,height:96,color:6});
});
