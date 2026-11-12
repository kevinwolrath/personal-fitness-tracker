#!/usr/bin/env node
/**
 * Live check of the Body Anvil health-sync API (#155): does the real server match docs/health-sync-api.md well enough
 * for the app, including CORS for the web build? Read-only and keyless: it sends no enrollment key and no owner token,
 * so nothing is created or changed on the server.
 *
 * Usage: npm run check:sync-server -- [base URL] [--origin http://localhost:8081]
 *   base URL: the value of BODY_ANVIL_API_URL (e.g. https://questspirestudios.com). Defaults to
 *             EXPO_PUBLIC_BODY_ANVIL_API_URL from the environment or .env.local.
 *   --origin: the web origin to check CORS for (default http://localhost:8081, `expo start --web`).
 * Exit 0 when every check passes, 1 otherwise. Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.
 */
const fs = require("node:fs");

const API_PREFIX = "/api/body-anvil/v1";
const DEFAULT_ORIGIN = "http://localhost:8081";
const NOBODY = "00000000-0000-4000-8000-000000000000";

/** The configured base URL as the app would use it, plus a problem if the value itself is wrong. */
function baseFrom(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { base: null, problem: "not a URL" };
  }
  if (u.protocol !== "https:") return { base: null, problem: "must start with https://" };
  const path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith(API_PREFIX))
    return { base: `${u.origin}${path.slice(0, -API_PREFIX.length)}`, problem: `ends in ${API_PREFIX}; the app adds that itself, so set it to ${u.origin}${path.slice(0, -API_PREFIX.length)}` };
  return { base: `${u.origin}${path}`, problem: null };
}

const lower = (v) => (v || "").toLowerCase();
const listHas = (header, item) => lower(header).split(",").map((s) => s.trim()).includes(item) || lower(header).trim() === "*";

/**
 * Run every check against `base` with `fetchImpl` (the global fetch, or a fake in tests).
 * Returns [{ name, ok, detail }]. Never throws.
 */
async function runChecks(base, fetchImpl, origin = DEFAULT_ORIGIN) {
  const api = `${base}${API_PREFIX}`;
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const call = async (method, path, headers = {}, body) => {
    try {
      const res = await fetchImpl(`${api}${path}`, { method, headers, body, redirect: "manual" });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // not JSON
      }
      return { status: res.status, headers: res.headers, json };
    } catch (e) {
      return { error: e && e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : String(e && e.message) };
    }
  };
  const describe = (r) => (r.error ? `request failed: ${r.error}` : `${r.status}${r.json && r.json.error ? ` ${JSON.stringify(r.json.error)}` : ""}`);
  const isJsonError = (r, status) => !r.error && r.status === status && r.json && typeof r.json.error === "string";
  const acao = (r) => (r.error ? null : r.headers.get("access-control-allow-origin"));
  const corsOk = (r) => acao(r) === origin || acao(r) === "*";

  // The API itself (no CORS involved: what the Android app sees).
  const snapshot = await call("GET", `/users/${NOBODY}/snapshot`, { Accept: "application/json", Origin: origin });
  check("Reachable, and a snapshot read without a token is refused (401 JSON)", isJsonError(snapshot, 401), describe(snapshot));
  const enroll = await call("POST", "/enroll", { Accept: "application/json", "Content-Type": "application/json", Origin: origin }, "{}");
  check("A first link without the enrollment key is refused (401 JSON)", isJsonError(enroll, 401), describe(enroll));
  const missing = await call("GET", "/__check-sync-server-unknown-route", { Accept: "application/json", Origin: origin });
  check("An unknown route is a JSON 404", isJsonError(missing, 404), describe(missing));

  // CORS (what a browser needs before it lets the web app see anything).
  const preflights = [
    ["POST", "/enroll", ["content-type", "x-enrollment-key"]],
    ["PUT", `/users/${NOBODY}/snapshot`, ["authorization", "content-type"]],
    ["GET", `/users/${NOBODY}/snapshot`, ["authorization"]],
    ["POST", `/users/${NOBODY}/shares`, ["authorization", "content-type"]],
    ["DELETE", `/users/${NOBODY}/shares/x`, ["authorization"]],
  ];
  for (const [method, path, wanted] of preflights) {
    const r = await call("OPTIONS", path, { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": wanted.join(",") });
    const problems = [];
    if (r.error) problems.push(describe(r));
    else {
      if (r.status < 200 || r.status >= 300) problems.push(`status ${r.status}`);
      if (!corsOk(r)) problems.push(`Access-Control-Allow-Origin is ${JSON.stringify(acao(r))}`);
      if (!listHas(r.headers.get("access-control-allow-methods"), lower(method))) problems.push(`${method} not in Access-Control-Allow-Methods`);
      for (const h of wanted) if (!listHas(r.headers.get("access-control-allow-headers"), h)) problems.push(`${h} not in Access-Control-Allow-Headers`);
    }
    check(`CORS preflight for ${method} ${path.replace(NOBODY, "<id>")} from ${origin}`, problems.length === 0, problems.join("; ") || `${r.status}`);
  }
  for (const [name, r] of [["401 (snapshot)", snapshot], ["401 (enroll)", enroll], ["404", missing]]) {
    if (r.error) continue;
    check(`CORS: the ${name} error response allows ${origin}`, corsOk(r), `Access-Control-Allow-Origin is ${JSON.stringify(acao(r))}`);
  }
  if (!snapshot.error)
    check("CORS: Retry-After is readable by the app (Access-Control-Expose-Headers)", listHas(snapshot.headers.get("access-control-expose-headers"), "retry-after"), `Access-Control-Expose-Headers is ${JSON.stringify(snapshot.headers.get("access-control-expose-headers"))}`);
  return results;
}

function fromEnvFile(name) {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`));
      if (m && m[1]) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local
  }
  return "";
}

async function main(argv) {
  let origin = DEFAULT_ORIGIN;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--origin") origin = argv[++i];
    else args.push(argv[i]);
  }
  const raw = args[0] || process.env.EXPO_PUBLIC_BODY_ANVIL_API_URL || fromEnvFile("EXPO_PUBLIC_BODY_ANVIL_API_URL");
  if (!raw) {
    console.error("Give the API base URL (e.g. https://questspirestudios.com), or set EXPO_PUBLIC_BODY_ANVIL_API_URL.");
    return 1;
  }
  const { base, problem } = baseFrom(raw);
  let failed = 0;
  if (problem) {
    console.log(`FAIL  The base URL ${raw} ${problem}`);
    failed++;
  }
  if (!base) return 1;
  console.log(`Checking ${base}${API_PREFIX} (no key or token sent; nothing is created)\n`);
  for (const r of await runChecks(base, fetch, origin)) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
    if (!r.ok) failed++;
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  return failed ? 1 : 0;
}

module.exports = { baseFrom, runChecks, API_PREFIX };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));
