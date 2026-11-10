#!/usr/bin/env node
/**
 * #120 PoC: print a Body Anvil configuration link for an update file, and the adb command that opens it on a
 * connected Android device or emulator (the app must be a build with the PoC handler, see docs/config-link-poc.md).
 *
 *   node scripts/config-link.cjs fixtures/config/lunch.update.json
 */
const { readFileSync } = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/config-link.cjs <update.json>');
  process.exit(1);
}
const json = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')));
const link = `personalfitnesstracker://configure?v=1&update=${encodeURIComponent(json)}`;
console.log(`JSON: ${json.length} characters; link: ${link.length} characters${json.length > 4000 ? ' (over the app limit of 4000: use Copy and Paste)' : ''}\n`);
console.log(link);
// adb passes the URL through a device shell: single quotes keep & and % intact.
console.log(`\nadb shell am start -W -a android.intent.action.VIEW -d '${link}' com.questspire.personalfitnesstracker`);
