const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ROOT } = require('../play-listing.cjs');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-publisher-')); fs.cpSync(ROOT, dir, { recursive: true }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function run(args, env = {}) {
  return new Promise(resolve => { const proc = spawn(process.execPath, [path.join(__dirname,'../publish-play-listing.cjs'), '--root', dir, ...args], { env: { ...process.env, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '', GOOGLE_PLAY_SERVICE_ACCOUNT_FILE: '', PLAY_PRODUCTION_APPROVED: '', PLAY_API_TEST_ORIGIN: '', ...env } });
    let output = ''; proc.stdout.on('data', b => output += b); proc.stderr.on('data', b => output += b); proc.on('close', code => resolve({ code, output })); });
}
test('default dry-run needs no credentials or API connection', async () => { expect((await run([])).code).toBe(0); });
test('production commit fails before contacting Play without approval', async () => { expect((await run(['--mode','commit','--track','production'])).output).toMatch(/explicit approval/); });
test.each([
  { mode: 'validate-only' }, { mode: 'commit' },
  { mode: 'commit', aab: true }, { mode: 'commit', aab: true, mismatch: true },
  { mode: 'commit', fail: true }, { mode: 'commit', aab: true, existingDraft: true },
])('$mode (AAB=$aab, mismatch=$mismatch, failure=$fail) owns and cleans up its edit', async ({ mode, aab, mismatch, fail, existingDraft }) => {
  const calls = [];
  const server = http.createServer((req,res) => {
    const chunks=[];req.on('data', c=>chunks.push(c));req.on('end',()=>{
      const body=Buffer.concat(chunks); calls.push({method:req.method,url:req.url,body});
      res.setHeader('content-type','application/json');
      if(req.url==='/token') return res.end(JSON.stringify({access_token:'test'}));
      if(req.url.endsWith('/edits') && req.method==='POST') return res.end('{"id":"listing-1"}');
      if (fail && req.method === 'PUT' && req.url.endsWith('/listings/en-AU')) { res.statusCode = 403; return res.end('{"error":{"message":"Listing permission refused"}}'); }
      if (req.url.includes('/bundles?uploadType=resumable')) { res.setHeader('location', 'http://127.0.0.1:' + server.address().port + '/session'); return res.end('{}'); }
      if (req.url === '/session') return res.end(JSON.stringify({ versionCode: mismatch ? 9 : 42 }));
      if (req.method === 'GET' && req.url.endsWith('/tracks/internal')) return res.end(JSON.stringify({ releases: [{ status: existingDraft ? 'draft' : 'completed', versionCodes: ['41'] }] }));
      res.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength:2048, privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'} });
  try {
    const args = ['--mode', mode];
    if (aab) { const file = path.join(dir, 'signed.aab'); fs.writeFileSync(file, 'fake signed bundle for API test'); args.push('--aab', file, '--version-code', '42'); }
    const result = await run(args, { PLAY_API_TEST_ORIGIN:`http://127.0.0.1:${server.address().port}`, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.com',private_key:privateKey}) });
    expect(result.code).toBe(fail || mismatch || existingDraft ? 1 : 0);
    if (fail || mismatch || existingDraft) {
      expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/edits/listing-1'))).toBe(true);
      expect(calls.some(c => c.url.includes(':commit'))).toBe(false);
      expect(calls.some(c => c.method === 'PUT' && c.url.includes('/tracks/'))).toBe(false);
      if (existingDraft) expect(calls.some(c => c.url.includes('uploadType=resumable'))).toBe(false);
      return;
    }
    expect(calls.filter(c=>c.url.includes('/upload/') && c.url.includes('uploadType=media'))).toHaveLength(5);
    expect(calls.some(c=>c.url.endsWith(':validate'))).toBe(true);
    expect(calls.some(c=>c.url.includes(':commit?changesNotSentForReview=true'))).toBe(mode==='commit');
    expect(calls.some(c=>c.method==='DELETE' && c.url.endsWith('/edits/listing-1'))).toBe(mode!=='commit');
    expect(calls.some(c=>c.url.includes('/tracks/'))).toBe(!!aab); // listing-only never changes a track
    if (aab) {
      const track = JSON.parse(calls.find(c => c.method === 'PUT' && c.url.endsWith('/tracks/internal')).body);
      expect(track.releases[0]).toEqual({ status: 'completed', versionCodes: ['41'] });
      expect(track.releases[1]).toMatchObject({ status: 'draft', versionCodes: ['42'], releaseNotes: [{ language: 'en-AU' }] });
    }
    for (const upload of calls.filter(c => c.url.includes('uploadType=media'))) expect(upload.body.subarray(1,4).toString()).toBe('PNG');
    const text=JSON.parse(calls.find(c=>c.method==='PUT'&&c.url.endsWith('/listings/en-AU')).body);
    expect(text.title).toBe('Body Anvil');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
