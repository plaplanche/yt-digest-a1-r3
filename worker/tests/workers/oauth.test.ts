import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";

const BASE = "http://worker.test";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };
const REDIRECT = "http://127.0.0.1:9/cb";
const GOOGLE = env.GOOGLE_ISSUER;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), env);
}

function register(body: unknown): Promise<Response> {
  return call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function newClient(name?: string): Promise<string> {
  const response = await register({ redirect_uris: [REDIRECT], ...(name === undefined ? {} : { client_name: name }) });
  return (await response.json<{ client_id: string }>()).client_id;
}

function authorizeQuery(clientId: string, extra: Record<string, string | null> = {}): string {
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: "challenge",
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...extra,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, value);
  return `/authorize?${query}`;
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("Location")!);
}

async function consentPage(clientId: string): Promise<{ request: string; html: string }> {
  const response = await call(authorizeQuery(clientId));
  expect(response.status).toBe(200);
  const html = await response.text();
  return { request: /name="request" value="([^"]+)"/.exec(html)![1]!, html };
}

function consent(request: string, decision: string): Promise<Response> {
  return call("/authorize/consent", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, decision }),
  });
}

// The fake Google: an RSA key, and answers for discovery, JWKS and the token endpoint.
let keys: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };
let otherKeys: CryptoKeyPair;
const b64 = (bytes: Uint8Array | string): string =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function sign(pair: CryptoKeyPair, claims: Record<string, unknown>): Promise<string> {
  const head = `${b64(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64(new Uint8Array(sig))}`;
}

interface Stub {
  email: string;
  verified: boolean;
  refreshToken: string | null;
  claims: Record<string, unknown>;
  signWith: () => CryptoKeyPair;
  tokenStatus: number;
  tokenRequests: URLSearchParams[];
}
let stub: Stub;
let nonceSeen = "";

beforeAll(async () => {
  const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  keys = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
  nonceSeen = "";
  stub = { email: "bob@test", verified: true, refreshToken: "google-refresh-secret", claims: {}, signWith: () => keys, tokenStatus: 200, tokenRequests: [] };
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== GOOGLE) return real(input, init);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: GOOGLE,
        authorization_endpoint: `${GOOGLE}/authorize`,
        token_endpoint: `${GOOGLE}/token`,
        jwks_uri: `${GOOGLE}/jwks`,
      });
    }
    if (url.pathname === "/jwks") return Response.json({ keys: [publicJwk] });
    if (url.pathname === "/token") {
      stub.tokenRequests.push(new URLSearchParams(String(init?.body)));
      if (stub.tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: stub.tokenStatus });
      const iat = Math.floor(Date.now() / 1000);
      const idToken = await sign(stub.signWith(), {
        iss: GOOGLE,
        aud: env.GOOGLE_CLIENT_ID,
        sub: `sub-${stub.email}`,
        email: stub.email,
        email_verified: stub.verified,
        iat,
        exp: iat + 3600,
        nonce: nonceSeen,
        ...stub.claims,
      });
      return Response.json({ access_token: "g-access", id_token: idToken, ...(stub.refreshToken === null ? {} : { refresh_token: stub.refreshToken }) });
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => vi.restoreAllMocks());

// Runs consent approval and returns Google's authorization URL.
async function approve(clientId: string): Promise<URL> {
  const { request } = await consentPage(clientId);
  const url = location(await consent(request, "approve"));
  nonceSeen = url.searchParams.get("nonce")!;
  return url;
}

function callback(params: Record<string, string>): Promise<Response> {
  return call(`/callback?${new URLSearchParams(params)}`);
}

async function login(email: string, options: Partial<Stub> = {}): Promise<{ response: Response; clientId: string }> {
  Object.assign(stub, { email }, options);
  const clientId = await newClient("Client");
  const google = await approve(clientId);
  return { response: await callback({ code: "g-code", state: google.searchParams.get("state")! }), clientId };
}

async function users(): Promise<{ user_sub: string; email: string; role: string }[]> {
  return (await (await call("/ops/users", { headers: OPS })).json<{ users: { user_sub: string; email: string; role: string }[] }>()).users;
}

describe("discovery (10.1)", () => {
  test("protected resource metadata, on both paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(await response.json()).toEqual({
        resource: `${BASE}/mcp`,
        authorization_servers: [BASE],
        scopes_supported: ["digest"],
        bearer_methods_supported: ["header"],
      });
    }
  });

  test("authorization server metadata", async () => {
    const response = await call("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
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
  test("registers a public client", async () => {
    const response = await register({
      redirect_uris: [REDIRECT, "https://app.example/cb"],
      client_name: "My client",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    expect(response.status).toBe(201);
    const body = await response.json<Record<string, unknown>>();
    expect(String(body.client_id).length).toBeGreaterThanOrEqual(16);
    expect(Math.abs(Number(body.client_id_issued_at) - Date.now() / 1000)).toBeLessThan(5);
    expect(body).toMatchObject({
      client_name: "My client",
      redirect_uris: [REDIRECT, "https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(body).not.toHaveProperty("client_secret");
    const row = await env.DB.prepare("SELECT client_name FROM oauth_clients WHERE client_id = ?").bind(body.client_id).first();
    expect(row).toEqual({ client_name: "My client" });
  });

  test("client_name is omitted when not given", async () => {
    const body = await (await register({ redirect_uris: [REDIRECT] })).json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("client_name");
  });

  test("a missing, empty or invalid redirect_uris gives invalid_redirect_uri", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`);
    const bodies = [
      {},
      { redirect_uris: [] },
      { redirect_uris: "https://a.example/cb" },
      { redirect_uris: [3] },
      { redirect_uris: ["http://a.example/cb"] },
      { redirect_uris: ["/relative"] },
      { redirect_uris: ["https://a.example/cb#frag"] },
      { redirect_uris: ["custom://cb"] },
      { redirect_uris: [REDIRECT, "nope"] },
      { redirect_uris: tooMany },
    ];
    for (const body of bodies) {
      const response = await register(body);
      expect(response.status).toBe(400);
      expect((await response.json<{ error: string }>()).error).toBe("invalid_redirect_uri");
    }
  });

  test("localhost over http and https are valid", async () => {
    expect((await register({ redirect_uris: ["http://localhost:3000/cb", "https://a.example/cb"] })).status).toBe(201);
  });

  test("any other invalid field gives invalid_client_metadata", async () => {
    const bodies = [
      { client_name: "x".repeat(201) },
      { client_name: 3 },
      { token_endpoint_auth_method: "client_secret_basic" },
      { grant_types: ["password"] },
      { grant_types: "authorization_code" },
      { response_types: ["token"] },
    ];
    for (const extra of bodies) {
      const response = await register({ redirect_uris: [REDIRECT], ...extra });
      expect(response.status).toBe(400);
      expect((await response.json<{ error: string }>()).error).toBe("invalid_client_metadata");
    }
    expect((await register({ redirect_uris: [REDIRECT], client_name: "x".repeat(200) })).status).toBe(201);
  });

  test("a body that is not a JSON object gives invalid_request", async () => {
    for (const body of ["not json", "[1]"]) {
      const response = await call("/register", { method: "POST", body });
      expect(response.status).toBe(400);
      expect((await response.json<{ error: string }>()).error).toBe("invalid_request");
    }
  });

  test("a GET on /register is a 404", async () => {
    expect((await call("/register")).status).toBe(404);
  });
});

describe("GET /authorize (10.3)", () => {
  test("an unknown client or a non-exact redirect_uri is a 400 page, never a redirect", async () => {
    const clientId = await newClient();
    const cases = [
      authorizeQuery("unknown-client"),
      authorizeQuery(clientId, { redirect_uri: null }),
      authorizeQuery(clientId, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(clientId, { redirect_uri: "http://127.0.0.1:9/other" }),
      authorizeQuery(clientId, { client_id: null }),
      authorizeQuery(clientId, { redirect_uri: "http://127.0.0.1:9/cb", response_type: "token", client_id: "other" }),
    ];
    for (const path of cases) {
      const response = await call(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Location")).toBeNull();
    }
  });

  test("each error redirects with error and state, in order", async () => {
    const clientId = await newClient();
    const cases: [Record<string, string | null>, string][] = [
      [{ response_type: "token", code_challenge: null, resource: null, scope: "other" }, "unsupported_response_type"],
      [{ response_type: null }, "unsupported_response_type"],
      [{ code_challenge: null, resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: "plain", resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: null }, "invalid_request"],
      [{ resource: null, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/other`, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/mcp/` }, "invalid_target"],
      [{ scope: "other" }, "invalid_scope"],
      [{ scope: "digest admin" }, "invalid_scope"],
    ];
    for (const [extra, error] of cases) {
      const url = location(await call(authorizeQuery(clientId, extra)));
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("error")).toBe(error);
      expect(url.searchParams.get("state")).toBe("client-state");
    }
    const noState = location(await call(authorizeQuery(clientId, { state: null, response_type: "token" })));
    expect(noState.searchParams.has("state")).toBe(false);
  });

  test("a valid request stores a pending authorization and shows the consent page", async () => {
    const clientId = await newClient("Acme <b>&\"'");
    const response = await call(authorizeQuery(clientId));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Acme &lt;b&gt;&amp;&quot;&#39;");
    expect(html).not.toContain("<b>");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    const id = /name="request" value="([^"]+)"/.exec(html)![1]!;
    expect(id.length).toBeGreaterThanOrEqual(16);
    const row = await env.DB.prepare("SELECT client_id, redirect_uri, client_state, code_challenge, scope, resource FROM oauth_requests WHERE request_id = ?")
      .bind(id)
      .first();
    expect(row).toEqual({ client_id: clientId, redirect_uri: REDIRECT, client_state: "client-state", code_challenge: "challenge", scope: "digest", resource: `${BASE}/mcp` });
  });

  test("the consent page shows the client_id when the client has no name, and scope defaults to digest", async () => {
    const clientId = await newClient();
    const html = await (await call(authorizeQuery(clientId, { scope: null }))).text();
    expect(html).toContain(clientId);
  });
});

describe("POST /authorize/consent (10.3)", () => {
  test("deny redirects with access_denied and uses the request up", async () => {
    const clientId = await newClient();
    const { request } = await consentPage(clientId);
    const url = location(await consent(request, "deny"));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("client-state");
    expect((await consent(request, "approve")).status).toBe(400);
  });

  test("approve redirects to Google with every parameter", async () => {
    const clientId = await newClient();
    const url = await approve(clientId);
    expect(url.origin + url.pathname).toBe(`${GOOGLE}/authorize`);
    const q = url.searchParams;
    expect(q.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(16);
    expect(q.get("state")).not.toBe(q.get("nonce"));
  });

  test("an unknown, expired or already approved request gives a 400 page", async () => {
    const clientId = await newClient();
    expect((await consent("unknown-request-id", "approve")).status).toBe(400);
    const { request } = await consentPage(clientId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = '2000-01-01T00:00:00.000Z' WHERE request_id = ?").bind(request).run();
    const expired = await consent(request, "approve");
    expect(expired.status).toBe(400);
    expect(expired.headers.get("Content-Type")).toContain("text/html");
    const second = await consentPage(clientId);
    expect((await consent(second.request, "approve")).status).toBe(302);
    expect((await consent(second.request, "approve")).status).toBe(400);
    expect((await consent(second.request, "deny")).status).toBe(400);
  });

  test("a missing request or an unknown decision gives a 400 page", async () => {
    const clientId = await newClient();
    const { request } = await consentPage(clientId);
    expect((await consent(request, "maybe")).status).toBe(400);
    expect((await call("/authorize/consent", { method: "POST", body: new URLSearchParams({ decision: "approve" }) })).status).toBe(400);
    expect((await consent(request, "approve")).status).toBe(302);
  });
});

describe("GET /callback (10.4)", () => {
  test("an unknown state gives a 400 page, and a state works only once", async () => {
    expect((await callback({ code: "x", state: "nope" })).status).toBe(400);
    expect((await call("/callback?code=x")).status).toBe(400);
    stub.email = "alice@test";
    const clientId = await newClient();
    const google = await approve(clientId);
    const state = google.searchParams.get("state")!;
    expect((await callback({ code: "g-code", state })).status).toBe(302);
    expect((await callback({ code: "g-code", state })).status).toBe(400);
  });

  test("an expired state gives a 400 page", async () => {
    const clientId = await newClient();
    const google = await approve(clientId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await callback({ code: "g-code", state: google.searchParams.get("state")! })).status).toBe(400);
  });

  test("a state is used up even when Google answers an error", async () => {
    const clientId = await newClient();
    const state = (await approve(clientId)).searchParams.get("state")!;
    const url = location(await callback({ error: "access_denied", state }));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("client-state");
    expect((await callback({ code: "g-code", state })).status).toBe(400);
  });

  test("an invited user gets a code and a member row", async () => {
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
    const { response, clientId } = await login("bob@test");
    const url = location(response);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("client-state");
    const code = url.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(await users()).toEqual([{ user_sub: "sub-bob@test", email: "bob@test", role: "member" }]);
    const stored = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, string | null>>();
    expect(stored).toMatchObject({
      client_id: clientId,
      user_sub: "sub-bob@test",
      redirect_uri: REDIRECT,
      code_challenge: "challenge",
      scope: "digest",
      resource: `${BASE}/mcp`,
      used_at: null,
    });
    expect(stored!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.code_hash).not.toBe(code);
    const invite = await env.DB.prepare("SELECT accepted_user_sub FROM invites WHERE email = 'bob@test'").first();
    expect(invite).toEqual({ accepted_user_sub: "sub-bob@test" });
    expect(new Date(stored!.expires_at!).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(stored!.expires_at!).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("the admin needs no invite and gets the admin role", async () => {
    const { response } = await login("Alice@Test");
    expect(location(response).searchParams.get("code")).not.toBeNull();
    expect(await users()).toEqual([{ user_sub: "sub-Alice@Test", email: "alice@test", role: "admin" }]);
  });

  test("the exchange with Google carries the secret, the callback URI and the code", async () => {
    await login("alice@test");
    expect(stub.tokenRequests).toHaveLength(1);
    const form = stub.tokenRequests[0]!;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("g-code");
    expect(form.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(form.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(form.get("client_secret")).toBe(env.GOOGLE_CLIENT_SECRET);
  });

  test("a non-invited, a revoked or an unverified user gets the 403 page and no row", async () => {
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "carol@test" }) });
    await call("/ops/invites/revoke", { method: "POST", headers: OPS, body: JSON.stringify({ email: "carol@test" }) });
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "dave@test" }) });
    const cases: [string, Partial<Stub>][] = [
      ["mallory@test", {}],
      ["carol@test", {}],
      ["dave@test", { verified: false }],
      ["alice@test", { verified: false }],
    ];
    for (const [email, options] of cases) {
      const { response } = await login(email, options);
      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("<title>Access refused</title>");
      expect(html).toContain("This account is not invited.");
    }
    expect(await users()).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first()).toEqual({ n: 0 });
  });

  test("a bad signature, a wrong aud, a wrong nonce, a wrong iss, an expired token or a failed exchange redirect with server_error", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const cases: Partial<Stub>[] = [
      { signWith: () => otherKeys },
      { claims: { aud: "someone-else" } },
      { claims: { nonce: "wrong-nonce" } },
      { claims: { nonce: undefined } },
      { claims: { iss: "http://evil.test" } },
      { claims: { exp: past } },
      { tokenStatus: 400 },
    ];
    for (const options of cases) {
      const { response } = await login("alice@test", { signWith: () => keys, claims: {}, tokenStatus: 200, ...options });
      const url = location(response);
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("error")).toBe("server_error");
      expect(url.searchParams.get("state")).toBe("client-state");
      expect(url.searchParams.has("code")).toBe(false);
    }
    expect(await users()).toEqual([]);
  });

  test("the Google refresh token is stored encrypted, never in clear", async () => {
    await login("alice@test");
    const row = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    expect(row!.enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    const raw = Uint8Array.from(atob(row!.enc.slice(3)), (c) => c.charCodeAt(0));
    expect(raw.length).toBeGreaterThan(12 + 16);
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(env.TOKEN_ENC_KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("google-refresh-secret");
    for (const table of ["users", "oauth_codes", "oauth_requests", "oauth_clients", "invites"]) {
      const dump = JSON.stringify((await env.DB.prepare(`SELECT * FROM ${table}`).all()).results);
      expect(dump).not.toContain("google-refresh-secret");
    }
  });

  test("each login uses a fresh IV, and a login without refresh token keeps the stored one", async () => {
    await login("alice@test");
    const first = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    await login("alice@test");
    const second = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    expect(second!.enc).not.toBe(first!.enc);
    await login("alice@test", { refreshToken: null });
    const third = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    expect(third!.enc).toBe(second!.enc);
    expect(await users()).toHaveLength(1);
  });
});

describe("log events", () => {
  test("registration, completion and denials are logged without secrets or e-mails", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      lines.push(JSON.parse(String(line)) as Record<string, unknown>);
    });
    const { response, clientId } = await login("alice@test");
    const code = location(response).searchParams.get("code")!;
    await login("mallory@test");
    const denied = await newClient();
    await consent((await consentPage(denied)).request, "deny");
    const events = lines.filter((l) => String(l.event).startsWith("auth."));
    expect(events.map((l) => [l.event, l.attrs])).toEqual([
      ["auth.client.registered", { client_id: clientId }],
      ["auth.oauth.completed", { client_id: clientId, role: "admin" }],
      ["auth.client.registered", { client_id: expect.any(String) }],
      ["auth.oauth.denied", { client_id: expect.any(String), reason: "not_invited" }],
      ["auth.client.registered", { client_id: denied }],
      ["auth.oauth.denied", { client_id: denied, reason: "access_denied" }],
    ]);
    const all = JSON.stringify(lines);
    for (const secret of [code, "google-refresh-secret", "alice@test", "mallory@test", "sub-alice@test"]) {
      expect(all).not.toContain(secret);
    }
  });
});
