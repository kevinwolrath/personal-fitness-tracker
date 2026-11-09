const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname,'..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function approvedBranding(base = root) {
  const dir=path.join(base,'assets/branding');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  for (const [name, expected] of Object.entries(manifest.sources)) {
    if (hash(fs.readFileSync(path.join(dir,name))) !== expected) throw Error(`Approved master changed: ${name}`);
  }
  const read = name => {
    const record=manifest.exports.find(e=>e.file===name);
    if (!record) throw Error(`Missing branding export ${name}; run npm run branding:build`);
    const bytes=fs.readFileSync(path.join(dir,'generated',name));
    if (hash(bytes)!==record.sha256) throw Error(`Branding export changed: ${name}; run npm run branding:build`);
    return bytes;
  };
  return {manifest,read};
}
module.exports={approvedBranding};
