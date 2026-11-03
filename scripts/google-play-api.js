"use strict";

/**
 * Google Play Developer API helpers for the release scripts (no dependencies; Node >= 20).
 * Used by resolve-android-version-code.js and upload-play-bundle.js.
 *
 * PLAY_API_TEST_ORIGIN (tests only) points every request at a local fake server. Only a loopback
 * http origin is accepted, so it can't redirect real credentials anywhere.
 */

const { createSign } = require("node:crypto");

function testOrigin() {
  const value = process.env.PLAY_API_TEST_ORIGIN;
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("PLAY_API_TEST_ORIGIN must be a loopback http origin.");
  }
  return url.origin;
}

function endpoints(packageName) {
  const origin = testOrigin();
  const api = origin || "https://androidpublisher.googleapis.com";
  const app = "/androidpublisher/v3/applications/" + encodeURIComponent(packageName);
  return { apiRoot: api + app, uploadRoot: api + "/upload" + app, tokenOverride: origin && origin + "/token" };
}

const encodeBase64Url = (value) => Buffer.from(value).toString("base64url");

/** Error that keeps Google's message and HTTP status, so callers can react to specific refusals. */
class PlayApiError extends Error {
  constructor(label, status, message) {
    super(label + " failed (HTTP " + status + "): " + message);
    this.status = status;
    this.apiMessage = message;
  }
}

async function requestJson(url, options = {}, label = "Google Play API request") {
  const response = await fetch(url, options);
  const body = await response.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(label + " returned non-JSON data (HTTP " + response.status + ").");
  }
  if (!response.ok) {
    throw new PlayApiError(label, response.status, data.error?.message || data.error_description || response.statusText);
  }
  return data;
}

async function getAccessToken(credentials, packageName) {
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Play service account JSON is missing client_email or private_key.");
  }
  const { tokenOverride } = endpoints(packageName);
  const tokenUri = tokenOverride || credentials.token_uri || "https://oauth2.googleapis.com/token";
  const tokenHost = new URL(tokenUri).hostname;
  if (!tokenOverride && tokenHost !== "oauth2.googleapis.com" && tokenHost !== "www.googleapis.com") {
    throw new Error("Google Play service account token_uri is not a Google OAuth endpoint.");
  }
  const now = Math.floor(Date.now() / 1000);
  const signingInput = [
    encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    encodeBase64Url(
      JSON.stringify({
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const assertion = signingInput + "." + signer.sign(credentials.private_key).toString("base64url");
  const response = await requestJson(
    tokenUri,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    },
    "Google OAuth token request",
  );
  if (typeof response.access_token !== "string" || !response.access_token) {
    throw new Error("Google OAuth did not return an access token.");
  }
  return response.access_token;
}

module.exports = { endpoints, requestJson, getAccessToken, PlayApiError };
