#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { ROOT, PACKAGE, validate, summary } = require('./play-listing.cjs');
const { endpoints, requestJson, getAccessToken } = require('./google-play-api');
const { startUpload, uploadBundle } = require('./upload-play-bundle');
async function main() {
  const { values: args } = parseArgs({ options: {
    mode: { type: 'string', default: 'dry-run' }, track: { type: 'string', default: 'internal' },
    root: { type: 'string', default: ROOT }, aab: { type: 'string' }, 'version-code': { type: 'string' },
  } });
  if (!['dry-run', 'validate-only', 'commit'].includes(args.mode)) throw new Error('Mode must be dry-run, validate-only or commit');
  if (!['internal','alpha','beta','production'].includes(args.track)) throw new Error('Unsupported track');
  if (args.track === 'production' && args.mode === 'commit' && process.env.PLAY_PRODUCTION_APPROVED !== 'production') throw new Error('Production commit requires explicit approval via the protected production workflow');
  if (args['version-code'] && !args.aab) throw new Error('--version-code requires --aab');
  const bundle = validate(args.root);
  if (args.aab && (!args.aab.endsWith('.aab') || !fs.statSync(args.aab).isFile() || !/^[1-9][0-9]*$/.test(args['version-code'] || ''))) throw new Error('AAB requires an existing .aab file and positive --version-code');
  console.log(JSON.stringify({ mode: args.mode, track: args.track, aab: !!args.aab, ...summary(bundle) }, null, 2));
  if (args.mode === 'dry-run') return; // No credentials read and no network requests.
  const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE ? fs.readFileSync(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE, 'utf8') : process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '{}');
  const token = await getAccessToken(credentials, PACKAGE);
  const { apiRoot, uploadRoot } = endpoints(PACKAGE);
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const edit = await requestJson(apiRoot + '/edits', { method: 'POST', headers, body: '{}' }, 'Create listing edit');
  if (!edit.id) throw new Error('Play returned no edit ID');
  const editRoot = apiRoot + '/edits/' + encodeURIComponent(edit.id);
  let committed = false;
  const json = (url, method, body) => requestJson(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    for (const locale of bundle.locales) {
      await json(editRoot + '/listings/' + locale.locale, 'PUT', { language: locale.locale, title: locale.text.title, shortDescription: locale.text['short-description'], fullDescription: locale.text['full-description'] });
      for (const [type, images] of Object.entries(locale.images)) {
        const imageRoot = editRoot + '/listings/' + locale.locale + '/' + type;
        await json(imageRoot, 'DELETE');
        for (const image of images) await requestJson(uploadRoot + '/edits/' + encodeURIComponent(edit.id) + '/listings/' + locale.locale + '/' + type + '?uploadType=media', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'image/png' }, body: image.bytes }, 'Upload ' + type);
      }
    }
    if (args.aab) {
      // Preserve served releases and staged rollouts. Never overwrite another draft.
      const trackRoot = editRoot + '/tracks/' + args.track;
      const current = await json(trackRoot, 'GET');
      const releases = current.releases || [];
      if (releases.some(r => r.status === 'draft')) throw new Error('Target track already has a draft release; resolve it in Play Console before uploading another');
      const size = fs.statSync(args.aab).size;
      const session = await startUpload(uploadRoot, edit.id, token, size);
      const uploaded = await uploadBundle(session, args.aab, size);
      if (String(uploaded.versionCode) !== args['version-code']) throw new Error('Bundle versionCode differs from requested version; refusing to assign track');
      // Draft only: uploading never rolls out a binary, even on production.
      await json(trackRoot, 'PUT', { track: args.track, releases: [...releases, { status: 'draft', versionCodes: [args['version-code']], releaseNotes: bundle.locales.map(l => ({ language: l.locale, text: l.text['release-notes'] })) }] });
    }
    await json(editRoot + ':validate', 'POST');
    if (args.mode === 'commit') {
      // Never retry without this flag: do not silently send listing changes for review.
      await json(editRoot + ':commit?changesNotSentForReview=true', 'POST');
      committed = true;
      console.log('Committed listing changes, not sent for review. Any uploaded release remains DRAFT. Review and submit in Play Console.');
    } else console.log('Google validated the temporary edit. It will be deleted without committing.');
  } finally {
    if (!committed) {
      try { await json(editRoot, 'DELETE'); }
      catch { throw new Error('Could not delete temporary Play edit ' + edit.id + '; remove it or let it expire before retrying.'); }
    }
  }
}
if (require.main === module) main().catch(e => { console.error('[play-listing] FAILED: ' + e.message); process.exitCode = 1; });
module.exports = { main };
