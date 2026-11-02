#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { createSign } = require("node:crypto");

const packageName = process.env.ANDROID_PACKAGE_NAME || "com.questspire.personalfitnesstracker";
const credentialsText = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "";
const requested = (process.env.REQUESTED_VERSION_CODE || "").trim();
const githubOutput = process.env.GITHUB_OUTPUT;
const maxVersionCode = 2_100_000_000;

function encodeBase64Url(value) { return Buffer.from(value).toString("base64url"); }
function parseCode(value) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= maxVersionCode ? number : null;
}
async function requestJson(url, options = {}, label = "Google Play API request") {
  const response = await fetch(url, options);
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; }
  catch { throw new Error(label + " returned non-JSON data (HTTP " + response.status + ")."); }
  if (!response.ok) {
    const message = data.error?.message || data.error_description || response.statusText;
    throw new Error(label + " failed (HTTP " + response.status + "): " + message);
  }
  return data;
}
async function getAccessToken(credentials) {
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Play service account JSON is missing client_email or private_key.");
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const tokenHost = new URL(tokenUri).hostname;
  if (tokenHost !== "oauth2.googleapis.com" && tokenHost !== "www.googleapis.com") throw new Error("Google Play service account token_uri is not a Google OAuth endpoint.");
  const now = Math.floor(Date.now() / 1000);
  const signingInput = [
    encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    encodeBase64Url(JSON.stringify({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: tokenUri, iat: now, exp: now + 3600 })),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput); signer.end();
  const assertion = signingInput + "." + signer.sign(credentials.private_key).toString("base64url");
  const response = await requestJson(tokenUri, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  }, "Google OAuth token request");
  if (typeof response.access_token !== "string" || !response.access_token) throw new Error("Google OAuth did not return an access token.");
  return response.access_token;
}
function collectCodes(values, target) { for (const value of values || []) { const code = parseCode(value); if (code !== null) target.push(code); } }

async function main() {
  if (!credentialsText) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not available to the version resolver.");
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is not available to the version resolver.");
  const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
  const configured = parseCode(app.expo?.android?.versionCode);
  if (configured === null) throw new Error("app.json expo.android.versionCode must be a positive integer <= " + maxVersionCode + ".");
  const credentials = JSON.parse(credentialsText);
  const accessToken = await getAccessToken(credentials);
  const apiRoot = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + encodeURIComponent(packageName);
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
