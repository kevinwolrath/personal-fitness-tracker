/** #155: the live sync-server check, against fake servers with and without CORS. */
const { baseFrom, runChecks } = require("../check-sync-server.cjs");

const ORIGIN = "http://localhost:8081";
const reply = (status, body, headers = {}) => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/** A fake of the Worker: the routes the check uses, with or without the CORS the web app needs. */
function worker({ cors }) {
  const corsHeaders = (init) => (cors ? { "access-control-allow-origin": init.headers.Origin, vary: "Origin", "access-control-expose-headers": "Retry-After" } : {});
  return async (url, init) => {
    const path = new URL(url).pathname.replace("/api/body-anvil/v1", "");
    if (!url.startsWith("https://api.example.test/api/body-anvil/v1/")) return reply(404, { error: "Not found" });
    if (init.method === "OPTIONS") {
      if (!cors) return reply(path === "/enroll" ? 405 : 400, { error: "Method not allowed" });
      return reply(204, undefined, {
        ...corsHeaders(init),
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization, X-Enrollment-Key",
      });
    }
    if (path === "/enroll") return reply(401, { error: "Enrollment key required or invalid" }, corsHeaders(init));
    if (/^\/users\/[^/]+\/snapshot$/.test(path)) return reply(401, { error: "Owner bearer credential required" }, corsHeaders(init));
    return reply(404, { error: "API route not found" }, corsHeaders(init));
  };
}

describe("baseFrom", () => {
  it("accepts a bare https origin", () => expect(baseFrom("https://questspirestudios.com/")).toEqual({ base: "https://questspirestudios.com", problem: null }));
  it("flags a value that already includes the API path, and says what to use", () => {
    const r = baseFrom("https://questspirestudios.com/api/body-anvil/v1");
    expect(r.base).toBe("https://questspirestudios.com");
    expect(r.problem).toMatch(/set it to https:\/\/questspirestudios\.com$/);
  });
  it("rejects http and non-URLs", () => {
    expect(baseFrom("http://questspirestudios.com").base).toBeNull();
    expect(baseFrom("questspirestudios.com").base).toBeNull();
  });
});

describe("runChecks", () => {
  it("passes against a server that follows the contract, CORS included", async () => {
    const results = await runChecks("https://api.example.test", worker({ cors: true }), ORIGIN);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThan(8);
  });

  it("without CORS: the API checks pass and every CORS check fails, naming the problem", async () => {
    const results = await runChecks("https://api.example.test", worker({ cors: false }), ORIGIN);
    const failed = results.filter((r) => !r.ok);
    expect(results.filter((r) => r.ok).map((r) => r.name)).toEqual([
      "Reachable, and a snapshot read without a token is refused (401 JSON)",
      "A first link without the enrollment key is refused (401 JSON)",
      "An unknown route is a JSON 404",
    ]);
    expect(failed.every((r) => r.name.startsWith("CORS"))).toBe(true);
    expect(failed.find((r) => r.name.includes("POST /enroll")).detail).toMatch(/status 405/);
  });

  it("an unreachable server fails the checks with the network error", async () => {
    const results = await runChecks("https://api.example.test", async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }, ORIGIN);
    expect(results[0]).toMatchObject({ ok: false, detail: "request failed: fetch failed (ENOTFOUND)" });
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it("the doubled API path (the original misconfiguration) gets 404s, not 401s", async () => {
    const results = await runChecks("https://api.example.test/api/body-anvil/v1", worker({ cors: true }), ORIGIN);
    expect(results[0].ok).toBe(false);
  });

  it("sends no enrollment key and no owner token", async () => {
    const seen = [];
    await runChecks("https://api.example.test", async (url, init) => {
      seen.push(init.headers);
      return worker({ cors: true })(url, init);
    }, ORIGIN);
    for (const h of seen) {
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("x-enrollment-key");
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    }
  });
});
