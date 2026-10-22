import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";

const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };
const BASE = "http://worker.test";
const ISSUER = env.GOOGLE_ISSUER;
const REDIRECT = "https://client.test/cb";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env);
}

const b64u = (value: ArrayBuffer | string): string =>
  btoa(typeof value === "string" ? value : String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

// The stub of Google: a key pair, and the claims and token response the next exchange will return.
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
let claimOverrides: Record<string, unknown> = {};
let signWith: CryptoKey | undefined;
let googleRefreshToken: string | undefined = "google-refresh-secret";
let googleCalls: string[] = [];
let lastNonce = "";

async function idToken(email: string, extra: Record<string, unknown>): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: env.GOOGLE_CLIENT_ID, sub: `g-${email}`, email, email_verified: true, iat, exp: iat + 3600, nonce: lastNonce, ...extra, ...claimOverrides };
  const signing = `${b64u(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64u(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signWith ?? keys.privateKey, new TextEncoder().encode(signing));
  return `${signing}.${b64u(signature)}`;
}

let loginEmail = "bob@test";

function stubGoogle(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    googleCalls.push(url);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
    if (url === `${ISSUER}/token`) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("client_secret") !== env.GOOGLE_CLIENT_SECRET || form.get("code") !== "google-code") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: "google-access",
        id_token: await idToken(loginEmail, {}),
        ...(googleRefreshToken === undefined ? {} : { refresh_token: googleRefreshToken }),
      });
    }
    return new Response("unexpected", { status: 500 });
  });
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
  claimOverrides = {};
  signWith = undefined;
  googleRefreshToken = "google-refresh-secret";
  googleCalls = [];
  loginEmail = "bob@test";
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function register(body: unknown = { redirect_uris: [REDIRECT], client_name: "Test client" }): Promise<Response> {
  return call("/register", { method: "POST", body: JSON.stringify(body) });
}

async function newClient(body?: unknown): Promise<string> {
  return ((await (await register(body)).json()) as { client_id: string }).client_id;
}

function authorizeQuery(clientId: string, overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return `/authorize?${query}`;
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("Location")!);
}

async function consentPage(clientId: string): Promise<{ html: string; request: string }> {
  const response = await call(authorizeQuery(clientId));
  expect(response.status).toBe(200);
  const html = await response.text();
  return { html, request: /name="request" value="([^"]+)"/.exec(html)![1]! };
}

function decide(request: string, decision: string): Promise<Response> {
  return call("/authorize/consent", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, decision }) });
}

// Runs the flow up to the redirect to Google and returns the callback URL Google would send the browser to.
async function approve(clientId: string): Promise<{ state: string; nonce: string }> {
  const { request } = await consentPage(clientId);
  const url = location(await decide(request, "approve"));
  lastNonce = url.searchParams.get("nonce")!;
  return { state: url.searchParams.get("state")!, nonce: lastNonce };
}

const callback = (query: Record<string, string>): Promise<Response> => call(`/callback?${new URLSearchParams(query)}`);

async function rows(sql: string): Promise<Record<string, unknown>[]> {
  return (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
}

function logged(spy: ReturnType<typeof vi.spyOn>): { event: string; attrs: Record<string, unknown> }[] {
  return spy.mock.calls.map((args: unknown[]) => JSON.parse(String(args[0])) as { event: string; attrs: Record<string, unknown> });
}

describe("discovery (10.1)", () => {
  test("the protected resource document, at both paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["digest"], bearer_methods_supported: ["header"] });
    }
  });

  test("the authorization server document", async () => {
    const response = await call("/.well-known/oauth-authorization-server");
    expect(await response.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["digest"],
    });
  });
});

describe("POST /register (10.2)", () => {
  test("a valid registration gets 201 and is stored; the event is logged", async () => {
    const spy = vi.spyOn(console, "error");
    const response = await register({ redirect_uris: [REDIRECT, "http://localhost:3000/x", "http://127.0.0.1/y"], client_name: "My <b>client</b>", grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" });
    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = await response.json<Record<string, unknown>>();
    expect(String(body.client_id).length).toBeGreaterThanOrEqual(16);
    expect(typeof body.client_id_issued_at).toBe("number");
    expect(body).toMatchObject({ client_name: "My <b>client</b>", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(body.redirect_uris).toEqual([REDIRECT, "http://localhost:3000/x", "http://127.0.0.1/y"]);
    expect(await rows("SELECT client_id, client_name FROM oauth_clients")).toEqual([{ client_id: body.client_id, client_name: "My <b>client</b>" }]);
    expect(logged(spy).filter((l) => l.event === "auth.client.registered")).toEqual([expect.objectContaining({ attrs: { client_id: body.client_id } })]);
  });

  test("client_name is omitted from the answer when not given", async () => {
    const body = await (await register({ redirect_uris: [REDIRECT] })).json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("client_name");
  });

  test("a missing, empty, too long or invalid redirect_uris gives invalid_redirect_uri", async () => {
    const bad: unknown[] = [
      {},
      { redirect_uris: [] },
      { redirect_uris: "https://a.test/cb" },
      { redirect_uris: [3] },
      { redirect_uris: ["http://a.test/cb"] },
      { redirect_uris: ["ftp://a.test/cb"] },
      { redirect_uris: ["/relative"] },
      { redirect_uris: ["https://a.test/cb#frag"] },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.test/${i}`) },
      { redirect_uris: [REDIRECT, "nope"], client_name: 3 },
    ];
    for (const body of bad) {
      const response = await register(body);
      expect(response.status).toBe(400);
      expect(await response.json<{ error: string }>()).toMatchObject({ error: "invalid_redirect_uri" });
    }
  });

  test("any other invalid field gives invalid_client_metadata", async () => {
    const bad = [
      { client_name: "x".repeat(201) },
      { client_name: 4 },
      { token_endpoint_auth_method: "client_secret_basic" },
      { grant_types: ["password"] },
      { grant_types: "authorization_code" },
      { response_types: ["token"] },
    ];
    for (const extra of bad) {
      const response = await register({ redirect_uris: [REDIRECT], ...extra });
      expect(response.status).toBe(400);
      expect(await response.json<{ error: string }>()).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect((await register({ redirect_uris: [REDIRECT], client_name: "x".repeat(200) })).status).toBe(201);
    expect(await rows("SELECT 1 FROM oauth_clients")).toHaveLength(1);
  });

  test("a body that is not a JSON object gives 400 invalid_request", async () => {
    for (const body of ["nope", "[]", "3"]) {
      const response = await call("/register", { method: "POST", body });
      expect(response.status).toBe(400);
      expect(await response.json<{ error: string }>()).toMatchObject({ error: "invalid_request" });
    }
  });
});

describe("GET /authorize (10.3)", () => {
  test("an unknown client or a missing or non-exact redirect_uri gives a 400 page, never a redirect", async () => {
    const id = await newClient();
    const cases = [
      authorizeQuery("unknown-client"),
      authorizeQuery(id, { redirect_uri: undefined }),
      authorizeQuery(id, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(id, { redirect_uri: "https://evil.test/cb" }),
      authorizeQuery(id, { redirect_uri: `${REDIRECT}?x=1` }),
      authorizeQuery(id, { response_type: "token", redirect_uri: "https://evil.test/cb" }),
      "/authorize",
    ];
    for (const path of cases) {
      const response = await call(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Content-Type")).toContain("text/html");
    }
    expect(await rows("SELECT 1 FROM oauth_requests")).toHaveLength(0);
  });

  test("each other error redirects with error and state, in order", async () => {
    const id = await newClient();
    const expectError = async (overrides: Record<string, string | undefined>, error: string): Promise<void> => {
      const url = location(await call(authorizeQuery(id, overrides)));
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("error")).toBe(error);
      expect(url.searchParams.get("state")).toBe("client-state");
    };
    await expectError({ response_type: "token", code_challenge: undefined, resource: "x", scope: "other" }, "unsupported_response_type");
    await expectError({ response_type: undefined }, "unsupported_response_type");
    await expectError({ code_challenge: undefined, resource: "x", scope: "other" }, "invalid_request");
    await expectError({ code_challenge: "" }, "invalid_request");
    await expectError({ code_challenge_method: undefined }, "invalid_request");
    await expectError({ code_challenge_method: "plain", resource: "x" }, "invalid_request");
    await expectError({ resource: undefined, scope: "other" }, "invalid_target");
    await expectError({ resource: `${BASE}/mcp/` }, "invalid_target");
    await expectError({ resource: "http://other.test/mcp" }, "invalid_target");
    await expectError({ scope: "other" }, "invalid_scope");
    await expectError({ scope: "digest extra" }, "invalid_scope");
    expect(await rows("SELECT 1 FROM oauth_requests")).toHaveLength(0);
  });

  test("a redirect without a client state carries no state, and keeps an existing query", async () => {
    const id = await newClient({ redirect_uris: ["https://client.test/cb?x=1"] });
    const url = location(await call(authorizeQuery(id, { redirect_uri: "https://client.test/cb?x=1", state: undefined, response_type: "token" })));
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.has("state")).toBe(false);
  });

  test("the consent page escapes the client name and holds the form", async () => {
    const id = await newClient({ redirect_uris: [REDIRECT], client_name: `<script>alert("x")</script>&` });
    const response = await call(authorizeQuery(id, { scope: "digest" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(/<input type="hidden" name="request" value="[^"]{16,}">/.test(html)).toBe(true);
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    expect(html.match(/<button type="submit" name="decision"/g)).toHaveLength(2);
    expect(await rows("SELECT client_id, client_state, scope, resource FROM oauth_requests")).toEqual([{ client_id: id, client_state: "client-state", scope: "digest", resource: `${BASE}/mcp` }]);
  });

  test("the consent page shows the client_id when the client has no name", async () => {
    const id = await newClient({ redirect_uris: [REDIRECT] });
    expect(await (await call(authorizeQuery(id))).text()).toContain(id);
  });
});

describe("POST /authorize/consent (10.3)", () => {
  test("an unknown, malformed or already used request gives a 400 page", async () => {
    const id = await newClient();
    expect((await decide("unknown", "approve")).status).toBe(400);
    const { request } = await consentPage(id);
    expect((await decide(request, "maybe")).status).toBe(400);
    expect((await call("/authorize/consent", { method: "POST", body: "{}" })).status).toBe(400);
    const denied = await decide(request, "deny");
    expect(denied.status).toBe(302);
    const again = await decide(request, "deny");
    expect(again.status).toBe(400);
    expect(again.headers.get("Content-Type")).toContain("text/html");
    expect((await decide(request, "approve")).status).toBe(400);
  });

  test("an expired request gives a 400 page", async () => {
    const id = await newClient();
    const { request } = await consentPage(id);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await decide(request, "approve")).status).toBe(400);
    expect((await decide(request, "deny")).status).toBe(400);
  });

  test("deny redirects with access_denied and the client state, and uses the request up", async () => {
    const spy = vi.spyOn(console, "error");
    const id = await newClient();
    const { request } = await consentPage(id);
    const url = location(await decide(request, "deny"));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("client-state");
    expect((await rows("SELECT used_at FROM oauth_requests"))[0]!.used_at).not.toBeNull();
    expect(logged(spy).filter((l) => l.event === "auth.oauth.denied")).toEqual([expect.objectContaining({ attrs: { client_id: id, reason: "access_denied" } })]);
  });

  test("approve redirects to Google with every parameter", async () => {
    const id = await newClient();
    const { request } = await consentPage(id);
    const url = location(await decide(request, "approve"));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(16);
    expect(p.get("state")).not.toBe(p.get("nonce"));
    expect(await rows("SELECT google_state, google_nonce, used_at FROM oauth_requests")).toEqual([{ google_state: p.get("state"), google_nonce: p.get("nonce"), used_at: null }]);
  });

  test("approve when Google's discovery fails redirects to the client with server_error", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const id = await newClient();
    const { request } = await consentPage(id);
    const url = location(await decide(request, "approve"));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("server_error");
    expect(url.searchParams.get("state")).toBe("client-state");
  });
});

describe("GET /callback (10.4)", () => {
  test("a state that matches nothing, is expired or is used gives a 400 page", async () => {
    const id = await newClient();
    expect((await callback({ state: "nope", code: "google-code" })).status).toBe(400);
    expect((await call("/callback")).status).toBe(400);
    const { state } = await approve(id);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await callback({ state, code: "google-code" })).status).toBe(400);
    expect(googleCalls).not.toContain(`${ISSUER}/token`);
  });

  test("a bad state is refused and the pending authorization stays usable", async () => {
    const id = await newClient();
    const { state } = await approve(id);
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    expect((await callback({ state: `${state}x`, code: "google-code" })).status).toBe(400);
    expect((await callback({ state, code: "google-code" })).status).toBe(302);
  });

  test("the state is used up by its first use", async () => {
    const id = await newClient();
    const { state } = await approve(id);
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    expect((await callback({ state, code: "google-code" })).status).toBe(302);
    expect((await callback({ state, code: "google-code" })).status).toBe(400);
    expect(await rows("SELECT 1 FROM oauth_codes")).toHaveLength(1);
  });

  test("an error from Google redirects to the client with access_denied", async () => {
    const spy = vi.spyOn(console, "error");
    const id = await newClient();
    const { state } = await approve(id);
    const url = location(await callback({ state, error: "access_denied" }));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("client-state");
    expect(logged(spy).filter((l) => l.event === "auth.oauth.denied")).toEqual([expect.objectContaining({ attrs: { client_id: id, reason: "google_error" } })]);
    expect(await rows("SELECT 1 FROM users")).toHaveLength(0);
  });

  const failures: [string, () => void][] = [
    ["a bad signature", () => void (signWith = undefined)],
    ["a wrong aud", () => void (claimOverrides = { aud: "someone-else" })],
    ["a wrong iss", () => void (claimOverrides = { iss: "http://evil.test" })],
    ["a wrong nonce", () => void (claimOverrides = { nonce: "other-nonce" })],
    ["a missing nonce", () => void (claimOverrides = { nonce: undefined })],
    ["an expired token", () => void (claimOverrides = { exp: Math.floor(Date.now() / 1000) - 10 })],
  ];
  for (const [name, setup] of failures) {
    test(`${name} redirects to the client with server_error and writes nothing`, async () => {
      await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
      const id = await newClient();
      const { state } = await approve(id);
      if (name === "a bad signature") {
        signWith = ((await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair).privateKey;
      } else {
        setup();
      }
      const url = location(await callback({ state, code: "google-code" }));
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("error")).toBe("server_error");
      expect(url.searchParams.get("state")).toBe("client-state");
      expect(url.searchParams.has("code")).toBe(false);
      expect(await rows("SELECT 1 FROM users")).toHaveLength(0);
      expect(await rows("SELECT 1 FROM oauth_codes")).toHaveLength(0);
    });
  }

  test("a failed code exchange redirects to the client with server_error", async () => {
    const id = await newClient();
    const { state } = await approve(id);
    const url = location(await callback({ state, code: "wrong-code" }));
    expect(url.searchParams.get("error")).toBe("server_error");
  });

  test("an invited user gets a code and a member row; the invite is accepted", async () => {
    const spy = vi.spyOn(console, "error");
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    const id = await newClient();
    const { state } = await approve(id);
    const url = location(await callback({ state, code: "google-code" }));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("client-state");
    const code = url.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(32);
    const users = await rows("SELECT user_sub, email, role, google_refresh_token_enc FROM users");
    expect(users).toEqual([{ user_sub: "g-bob@test", email: "bob@test", role: "member", google_refresh_token_enc: expect.stringMatching(/^v1:/) }]);
    expect(await rows("SELECT accepted_user_sub FROM invites")).toEqual([{ accepted_user_sub: "g-bob@test" }]);
    const stored = await rows("SELECT code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at, used_at FROM oauth_codes");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ client_id: id, user_sub: "g-bob@test", redirect_uri: REDIRECT, code_challenge: CHALLENGE, scope: "digest", resource: `${BASE}/mcp`, used_at: null });
    expect(stored[0]!.code_hash).not.toBe(code);
    expect(stored[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const lines = logged(spy);
    expect(lines.filter((l) => l.event === "auth.oauth.completed")).toEqual([expect.objectContaining({ attrs: { client_id: id, role: "member" } })]);
    const text = spy.mock.calls.map((a: unknown[]) => String(a[0])).join("\n");
    for (const secret of [code, "google-refresh-secret", "bob@test", "g-bob@test", "google-code"]) expect(text).not.toContain(secret);
  });

  test("the admin needs no invite and gets the admin role", async () => {
    loginEmail = "alice@test";
    const id = await newClient();
    const { state } = await approve(id);
    expect(location(await callback({ state, code: "google-code" })).searchParams.get("code")).not.toBeNull();
    expect(await rows("SELECT user_sub, role FROM users")).toEqual([{ user_sub: "g-alice@test", role: "admin" }]);
  });

  test("the e-mail is compared lowercased", async () => {
    loginEmail = "Bob@Test";
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    const id = await newClient();
    const { state } = await approve(id);
    expect(location(await callback({ state, code: "google-code" })).searchParams.get("code")).not.toBeNull();
    expect(await rows("SELECT email FROM users")).toEqual([{ email: "bob@test" }]);
  });

  test("no stored value holds the Google refresh token in clear, and it decrypts with the key", async () => {
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    const id = await newClient();
    const { state } = await approve(id);
    await callback({ state, code: "google-code" });
    for (const table of ["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      expect(JSON.stringify(await rows(`SELECT * FROM ${table}`))).not.toContain("google-refresh-secret");
    }
    const enc = (await rows("SELECT google_refresh_token_enc AS e FROM users"))[0]!.e as string;
    const raw = Uint8Array.from(atob(enc.slice(3)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(env.TOKEN_ENC_KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("google-refresh-secret");
  });

  test("two logins use different IVs, and a login without refresh token keeps the stored one", async () => {
    await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('bob@test', 'now')").run();
    const id = await newClient();
    await callback({ state: (await approve(id)).state, code: "google-code" });
    const first = (await rows("SELECT google_refresh_token_enc AS e FROM users"))[0]!.e;
    await callback({ state: (await approve(id)).state, code: "google-code" });
    const second = (await rows("SELECT google_refresh_token_enc AS e FROM users"))[0]!.e;
    expect(second).not.toBe(first);
    googleRefreshToken = undefined;
    await callback({ state: (await approve(id)).state, code: "google-code" });
    expect((await rows("SELECT google_refresh_token_enc AS e FROM users"))[0]!.e).toBe(second);
    expect(await rows("SELECT 1 FROM users")).toHaveLength(1);
  });

  test("a non-invited, revoked or unverified user gets the 403 page and no row", async () => {
    const spy = vi.spyOn(console, "error");
    await env.DB.prepare("INSERT INTO invites (email, invited_at, revoked) VALUES ('bob@test', 'now', 1)").run();
    const id = await newClient();
    const cases: [string, string, Record<string, unknown>][] = [
      ["mallory@test", "not_invited", {}],
      ["bob@test", "not_invited", {}],
      ["alice@test", "email_unverified", { email_verified: false }],
      ["alice@test", "email_unverified", { email_verified: "true" }],
    ];
    for (const [email, reason, claims] of cases) {
      loginEmail = email;
      claimOverrides = claims;
      const { state } = await approve(id);
      const response = await callback({ state, code: "google-code" });
      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("<title>Access refused</title>");
      expect(html).toContain("This account is not invited.");
      expect(response.headers.get("Location")).toBeNull();
      expect(await rows("SELECT 1 FROM users")).toHaveLength(0);
      expect(await rows("SELECT 1 FROM oauth_codes")).toHaveLength(0);
      expect(logged(spy).filter((l) => l.event === "auth.oauth.denied").at(-1)!.attrs).toEqual({ client_id: id, reason });
    }
  });
});
