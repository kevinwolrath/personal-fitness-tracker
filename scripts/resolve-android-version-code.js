#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { endpoints, requestJson, getAccessToken } = require("./google-play-api");

const packageName = process.env.ANDROID_PACKAGE_NAME || "com.questspire.personalfitnesstracker";
const credentialsText = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "";
const requested = (process.env.REQUESTED_VERSION_CODE || "").trim();
const githubOutput = process.env.GITHUB_OUTPUT;
const maxVersionCode = 2_100_000_000;

function parseCode(value) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= maxVersionCode ? number : null;
}
function collectCodes(values, target) { for (const value of values || []) { const code = parseCode(value); if (code !== null) target.push(code); } }

async function main() {
  if (!credentialsText) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not available to the version resolver.");
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is not available to the version resolver.");
  const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
  const configured = parseCode(app.expo?.android?.versionCode);
  if (configured === null) throw new Error("app.json expo.android.versionCode must be a positive integer <= " + maxVersionCode + ".");
  const credentials = JSON.parse(credentialsText);
  const accessToken = await getAccessToken(credentials, packageName);
  const { apiRoot } = endpoints(packageName);
  const edit = await requestJson(apiRoot + "/edits", { method: "POST", headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" }, body: "{}" }, "Create temporary Google Play edit");
  if (!edit.id) throw new Error("Google Play did not return an edit ID.");
  try {
    const editRoot = apiRoot + "/edits/" + encodeURIComponent(edit.id);
    const [bundles, apks, tracks] = await Promise.all([
      requestJson(editRoot + "/bundles", { headers: { authorization: "Bearer " + accessToken } }, "List Play App Bundles"),
      requestJson(editRoot + "/apks", { headers: { authorization: "Bearer " + accessToken } }, "List Play APKs"),
      requestJson(editRoot + "/tracks", { headers: { authorization: "Bearer " + accessToken } }, "List Play tracks"),
    ]);
    const codes = [configured];
    collectCodes((bundles.bundles || []).map(bundle => bundle.versionCode), codes);
    collectCodes((apks.apks || []).map(apk => apk.versionCode), codes);
    for (const track of tracks.tracks || []) for (const release of track.releases || []) collectCodes(release.versionCodes, codes);
    const currentMax = Math.max(...codes);
    let chosenCode;
    if (requested) {
      const requestedCode = parseCode(requested);
      if (requestedCode === null) throw new Error("Requested version code must be a positive integer <= " + maxVersionCode + ".");
      if (requestedCode <= currentMax) throw new Error("Requested version code " + requestedCode + " is not higher than the current Play maximum " + currentMax + ".");
      chosenCode = requestedCode;
    } else chosenCode = currentMax + 1;
    if (chosenCode > maxVersionCode) throw new Error("The next Android version code would exceed " + maxVersionCode + ".");
    fs.appendFileSync(githubOutput, "value=" + chosenCode + "\n");
    console.log("Google Play current maximum versionCode: " + currentMax);
    console.log("Resolved Android versionCode for this build: " + chosenCode);
  } finally {
    try { await fetch(apiRoot + "/edits/" + encodeURIComponent(edit.id), { method: "DELETE", headers: { authorization: "Bearer " + accessToken } }); }
    catch (error) { console.warn("Could not delete the temporary Google Play edit:", error.message); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
