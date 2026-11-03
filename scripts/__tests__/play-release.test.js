/**
 * The Play release scripts against a local fake of the Google Play Developer API, including the resumable
 * upload protocol and connections that drop part-way through a chunk (the run 8 failure).
 * Runs the real scripts as child processes, as the release container does.
 */
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const PKG = "com.questspire.personalfitnesstracker";
const APP = "/androidpublisher/v3/applications/" + PKG;
const scripts = path.join(__dirname, "..");

function fakePlay(opts = {}) {
  const state = { stored: Buffer.alloc(0), size: 0, puts: 0, drops: 0, tracks: [], commits: [], deleted: [], edits: 0 };
  let dropsLeft = opts.drops ?? 0;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => {
      chunks.push(c);
      // Drop the connection half-way through a chunk upload: Google keeps what arrived (in 256 KiB units).
      const isChunk = req.method === "PUT" && req.url.startsWith("/session") && !/\*/.test(req.headers["content-range"] || "");
      const got = chunks.reduce((n, x) => n + x.length, 0);
      if (isChunk && dropsLeft > 0 && got >= 3 * 1024 * 1024) {
        dropsLeft--;
        state.drops++;
        const start = Number(/bytes (\d+)-/.exec(req.headers["content-range"])[1]);
        const keep = Math.floor(got / (256 * 1024)) * 256 * 1024;
        state.stored = Buffer.concat([state.stored.subarray(0, start), Buffer.concat(chunks).subarray(0, keep)]);
        req.socket.destroy();
      }
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://x");
      if (req.method === "POST" && url.pathname === "/token") return json(res, 200, { access_token: "fake-token" });
      if (req.headers.authorization !== "Bearer fake-token" && !url.pathname.startsWith("/session")) return json(res, 401, { error: { message: "no auth" } });
      if (req.method === "POST" && url.pathname === APP + "/edits") {
        state.edits++;
        return json(res, 200, { id: "edit-1" });
      }
      if (req.method === "GET" && url.pathname === APP + "/edits/edit-1/bundles") return json(res, 200, { bundles: [{ versionCode: 1 }] });
      if (req.method === "GET" && url.pathname === APP + "/edits/edit-1/apks") return json(res, 200, {});
      if (req.method === "GET" && url.pathname === APP + "/edits/edit-1/tracks") {
        return json(res, 200, { tracks: [{ track: "internal", releases: [{ versionCodes: ["1"] }] }] });
      }
      if (req.method === "POST" && url.pathname === "/upload" + APP + "/edits/edit-1/bundles") {
        state.size = Number(req.headers["x-upload-content-length"]);
        res.writeHead(200, { location: "http://" + req.headers.host + "/session/1" });
        return res.end();
      }
      if (req.method === "PUT" && url.pathname === "/session/1") {
        state.puts++;
        const range = req.headers["content-range"];
        const query = /^bytes \*\/(\d+)$/.exec(range);
        if (!query) {
          const [, a] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range).map(Number);
          if (a !== state.stored.length) return json(res, 400, { error: { message: "offset mismatch " + a + " vs " + state.stored.length } });
          state.stored = Buffer.concat([state.stored, body]);
        }
        if (state.stored.length === state.size) {
          return json(res, 200, { versionCode: opts.bundleVersionCode ?? 2, sha256: crypto.createHash("sha256").update(state.stored).digest("hex") });
        }
        const headers = state.stored.length ? { range: "bytes=0-" + (state.stored.length - 1) } : {};
        res.writeHead(308, headers);
        return res.end();
      }
      if (req.method === "PUT" && url.pathname === APP + "/edits/edit-1/tracks/internal") {
        const release = JSON.parse(body.toString());
        state.tracks.push(release);
        if (opts.draftApp && release.releases[0].status !== "draft") {
          return json(res, 400, { error: { message: "Only releases with status draft may be created on draft app." } });
        }
        return json(res, 200, release);
      }
      if (req.method === "POST" && url.pathname === APP + "/edits/edit-1:commit") {
        state.commits.push(url.search);
        return json(res, 200, { id: "edit-1" });
      }
      if (req.method === "DELETE" && url.pathname === APP + "/edits/edit-1") {
        state.deleted.push("edit-1");
        res.writeHead(204);
        return res.end();
      }
      json(res, 404, { error: { message: "unexpected " + req.method + " " + url.pathname } });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, origin: "http://127.0.0.1:" + server.address().port })));
}

function run(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(scripts, script)], { env: { PATH: process.env.PATH, ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

let dir;
let aab;
let keyFile;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "play-test-"));
  aab = path.join(dir, "app-release.aab");
  fs.writeFileSync(aab, crypto.randomBytes(20 * 1024 * 1024 + 12345)); // 3 chunks, last one partial
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  keyFile = path.join(dir, "sa.json");
  fs.writeFileSync(keyFile, JSON.stringify({ client_email: "ci@example.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const uploadEnv = (origin) => ({
  PLAY_API_TEST_ORIGIN: origin,
  PLAY_UPLOAD_BACKOFF_MS: "10",
  AAB_PATH: aab,
  ANDROID_PACKAGE_NAME: PKG,
  ANDROID_VERSION_CODE: "2",
  GOOGLE_PLAY_SERVICE_ACCOUNT_FILE: keyFile,
});
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("upload-play-bundle.js", () => {
  test("uploads the whole bundle and releases it to internal", async () => {
    const play = await fakePlay();
    const r = await run("upload-play-bundle.js", uploadEnv(play.origin));
    play.server.close();
    expect(r.code).toBe(0);
    expect(sha(aab)).toBe(crypto.createHash("sha256").update(play.state.stored).digest("hex"));
    expect(play.state.tracks).toEqual([{ track: "internal", releases: [{ versionCodes: ["2"], status: "completed" }] }]);
    expect(play.state.commits).toEqual([""]);
    expect(play.state.deleted).toEqual([]);
  });

  test("resumes from what Google stored when the connection drops mid-chunk", async () => {
    const play = await fakePlay({ drops: 2 });
    const r = await run("upload-play-bundle.js", uploadEnv(play.origin));
    play.server.close();
    expect(r.code).toBe(0);
    expect(play.state.drops).toBe(2);
    expect(r.out).toMatch(/resuming from there/);
    // Byte-exact: nothing duplicated or skipped across the resumes.
    expect(sha(aab)).toBe(crypto.createHash("sha256").update(play.state.stored).digest("hex"));
    expect(play.state.commits).toEqual([""]);
  });

  test("gives up after the retry budget, and deletes the unfinished edit", async () => {
    const play = await fakePlay({ drops: 99 });
    const r = await run("upload-play-bundle.js", { ...uploadEnv(play.origin), PLAY_UPLOAD_MAX_ATTEMPTS: "3" });
    play.server.close();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/kept failing after 3 attempts/);
    expect(play.state.commits).toEqual([]);
    expect(play.state.deleted).toEqual(["edit-1"]);
  });

  test("a never-published app gets a DRAFT internal release", async () => {
    const play = await fakePlay({ draftApp: true });
    const r = await run("upload-play-bundle.js", uploadEnv(play.origin));
    play.server.close();
    expect(r.code).toBe(0);
    expect(play.state.tracks.map((t) => t.releases[0].status)).toEqual(["completed", "draft"]);
    expect(r.out).toMatch(/DRAFT internal release/);
  });

  test("refuses to commit when Play reads a different versionCode from the bundle", async () => {
    const play = await fakePlay({ bundleVersionCode: 7 });
    const r = await run("upload-play-bundle.js", uploadEnv(play.origin));
    play.server.close();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/versionCode 7 from the bundle, expected 2/);
    expect(play.state.tracks).toEqual([]);
    expect(play.state.deleted).toEqual(["edit-1"]);
  });

  test("only a loopback test origin is accepted", async () => {
    const r = await run("upload-play-bundle.js", { ...uploadEnv("https://example.com"), PLAY_API_TEST_ORIGIN: "https://example.com" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/loopback/);
  });
});

describe("resolve-android-version-code.js (shared helpers)", () => {
  test("still resolves the next version code", async () => {
    const play = await fakePlay();
    const output = path.join(dir, "github-output.txt");
    const r = await run("resolve-android-version-code.js", {
      PLAY_API_TEST_ORIGIN: play.origin,
      ANDROID_PACKAGE_NAME: PKG,
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: fs.readFileSync(keyFile, "utf8"),
      GITHUB_OUTPUT: output,
    });
    play.server.close();
    expect(r.code).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe("value=2\n");
    expect(play.state.deleted).toEqual(["edit-1"]);
  });
});
