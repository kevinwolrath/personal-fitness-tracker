#!/usr/bin/env node
"use strict";

/**
 * Upload a signed AAB to the Google Play INTERNAL track and commit it (no fastlane).
 *
 * The bundle goes up as a resumable upload in 8 MiB chunks. When the connection drops (the run 8
 * failure was "SSL_read: unexpected eof" part-way through the upload), the script asks Google how
 * much arrived and continues from there, with backoff, instead of failing a 25-minute build.
 *
 * Env: AAB_PATH, ANDROID_PACKAGE_NAME, ANDROID_VERSION_CODE, GOOGLE_PLAY_SERVICE_ACCOUNT_FILE.
 * The track is fixed to "internal": this script cannot release to any other track.
 */

const fs = require("node:fs");
const { endpoints, requestJson, getAccessToken, PlayApiError } = require("./google-play-api");

const TRACK = "internal";
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const MAX_ATTEMPTS = Number(process.env.PLAY_UPLOAD_MAX_ATTEMPTS || 8);
const BACKOFF_MS = Number(process.env.PLAY_UPLOAD_BACKOFF_MS || 2000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log("[play-upload] " + message);

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(name + " is required.");
  return value;
}

/** Bytes Google has stored so far, from a 308 response's Range header ("bytes=0-N"). */
function storedBytes(response) {
  const range = response.headers.get("range");
  const match = range && /bytes=0-(\d+)/.exec(range);
  return match ? Number(match[1]) + 1 : 0;
}

/** Transient: network errors, 408/429 and 5xx. Anything else is a real refusal and stops the upload. */
const transientStatus = (status) => status === 408 || status === 429 || status >= 500;

async function startUpload(uploadRoot, editId, token, size) {
  const url = uploadRoot + "/edits/" + encodeURIComponent(editId) + "/bundles?uploadType=resumable";
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "x-upload-content-type": "application/octet-stream",
          "x-upload-content-length": String(size),
          "content-length": "0",
        },
        redirect: "manual",
      });
      const session = response.headers.get("location");
      if (response.ok && session) return session;
      const text = await response.text();
      if (!transientStatus(response.status) || attempt >= MAX_ATTEMPTS) {
        throw new PlayApiError("Start bundle upload", response.status, text.slice(0, 300) || response.statusText);
      }
    } catch (error) {
      if (error instanceof PlayApiError || attempt >= MAX_ATTEMPTS) throw error;
      log("start failed (" + error.message + "); retrying");
    }
    await sleep(BACKOFF_MS * 2 ** (attempt - 1));
  }
}

/** Ask Google how much of the upload it holds. Returns { done, bundle } or { offset }. */
async function queryUpload(session, size) {
  const response = await fetch(session, {
    method: "PUT",
    headers: { "content-range": "bytes */" + size, "content-length": "0" },
    redirect: "manual",
  });
  if (response.status === 200 || response.status === 201) return { done: true, bundle: await response.json() };
  if (response.status === 308) return { offset: storedBytes(response) };
  const text = await response.text();
  if (transientStatus(response.status)) throw new Error("status query HTTP " + response.status);
  throw new PlayApiError("Bundle upload status", response.status, text.slice(0, 300) || response.statusText);
}

async function uploadBundle(session, file, size) {
  const fd = fs.openSync(file, "r");
  try {
    let offset = 0;
    let attempt = 0;
    let lastLogged = -1;
    while (true) {
      const end = Math.min(offset + CHUNK, size);
      const chunk = Buffer.alloc(end - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset);
      try {
        const response = await fetch(session, {
          method: "PUT",
          headers: { "content-range": "bytes " + offset + "-" + (end - 1) + "/" + size },
          body: chunk,
          redirect: "manual",
        });
        if (response.status === 200 || response.status === 201) return response.json();
        if (response.status === 308) {
          offset = storedBytes(response);
          attempt = 0;
          const percent = Math.floor((offset / size) * 100);
          if (percent >= lastLogged + 10) {
            log("uploaded " + percent + "% (" + offset + " of " + size + " bytes)");
            lastLogged = percent;
          }
          continue;
        }
        const text = await response.text();
        if (!transientStatus(response.status)) {
          throw new PlayApiError("Bundle upload", response.status, text.slice(0, 300) || response.statusText);
        }
        throw new Error("HTTP " + response.status);
      } catch (error) {
        if (error instanceof PlayApiError) throw error;
        attempt++;
        if (attempt >= MAX_ATTEMPTS) throw new Error("Bundle upload kept failing after " + attempt + " attempts: " + error.message);
        const wait = BACKOFF_MS * 2 ** (attempt - 1);
        log("connection problem at byte " + offset + " (" + error.message + "); resuming in " + wait / 1000 + "s");
        await sleep(wait);
        // Find out what Google actually stored before sending more.
        try {
          const state = await queryUpload(session, size);
          if (state.done) return state.bundle;
          offset = state.offset;
          log("Google holds " + offset + " bytes; resuming from there");
        } catch (queryError) {
          if (queryError instanceof PlayApiError) throw queryError;
          log("status check failed (" + queryError.message + "); will retry");
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Google's refusals that have a known, safe answer. */
const isDraftAppRefusal = (error) => error instanceof PlayApiError && /draft app/i.test(error.apiMessage || "");
const needsNotSentForReview = (error) => error instanceof PlayApiError && /changesNotSentForReview/i.test(error.apiMessage || "");

async function main() {
  const aab = required("AAB_PATH");
  const packageName = required("ANDROID_PACKAGE_NAME");
  const versionCode = required("ANDROID_VERSION_CODE");
  const credentials = JSON.parse(fs.readFileSync(required("GOOGLE_PLAY_SERVICE_ACCOUNT_FILE"), "utf8"));
  const size = fs.statSync(aab).size;
  const { apiRoot, uploadRoot } = endpoints(packageName);

  const token = await getAccessToken(credentials, packageName);
  const auth = { authorization: "Bearer " + token, "content-type": "application/json" };
  const edit = await requestJson(apiRoot + "/edits", { method: "POST", headers: auth, body: "{}" }, "Create Google Play edit");
  if (!edit.id) throw new Error("Google Play did not return an edit ID.");
  const editRoot = apiRoot + "/edits/" + encodeURIComponent(edit.id);
  let committed = false;

  try {
    log("uploading " + aab + " (" + (size / 1024 / 1024).toFixed(1) + " MiB) to " + packageName);
    const session = await startUpload(uploadRoot, edit.id, token, size);
    const bundle = await uploadBundle(session, aab, size);
    if (String(bundle.versionCode) !== String(versionCode)) {
      throw new Error("Play read versionCode " + bundle.versionCode + " from the bundle, expected " + versionCode + ".");
    }
    log("bundle stored: versionCode " + bundle.versionCode + ", sha256 " + bundle.sha256);

    const setTrack = (status) =>
      requestJson(
        editRoot + "/tracks/" + TRACK,
        { method: "PUT", headers: auth, body: JSON.stringify({ track: TRACK, releases: [{ versionCodes: [String(versionCode)], status }] }) },
        "Update " + TRACK + " track",
      );
    const commit = (notForReview) =>
      requestJson(editRoot + ":commit" + (notForReview ? "?changesNotSentForReview=true" : ""), { method: "POST", headers: auth }, "Commit Google Play edit");

    let status = "completed";
    try {
      await setTrack(status);
    } catch (error) {
      if (!isDraftAppRefusal(error)) throw error;
      // An app that has never been published only accepts draft releases.
      status = "draft";
      log("Play only accepts draft releases for this app yet; creating a DRAFT internal release");
      await setTrack(status);
    }

    try {
      await commit(false);
    } catch (error) {
      if (isDraftAppRefusal(error) && status !== "draft") {
        status = "draft";
        log("Play only accepts draft releases for this app yet; creating a DRAFT internal release");
        await setTrack(status);
        await commit(false);
      } else if (needsNotSentForReview(error)) {
        await commit(true);
      } else {
        throw error;
      }
    }
    committed = true;

    if (status === "draft") {
      log("DONE: versionCode " + versionCode + " is a DRAFT internal release. Roll it out in Play Console: Testing > Internal testing.");
    } else {
      log("DONE: versionCode " + versionCode + " released to internal testing.");
    }
  } finally {
    if (!committed) {
      try {
        await fetch(editRoot, { method: "DELETE", headers: { authorization: "Bearer " + token } });
      } catch (error) {
        console.warn("Could not delete the unfinished Google Play edit: " + error.message);
      }
    }
  }
}

module.exports = { startUpload, uploadBundle };
if (require.main === module) main().catch((error) => {
  console.error("[play-upload] FAILED: " + error.message);
  process.exitCode = 1;
});
