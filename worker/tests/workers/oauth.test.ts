import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";

const BASE = "http://worker.test";
const GOOGLE = "http://google.test";
const REDIRECT = "http://127.0.0.1:9/cb";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

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
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...extra,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, value);
  return `/authorize?${query}`;
}

function consent(request: string, decision: string): Promise<Response> {
  return call("/authorize/consent", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, decision }),
  });
}

async function pendingId(clientId: string, extra: Record<string, string | null> = {}): Promise<string> {
  const response = await call(authorizeQuery(clientId, extra));
  expect(response.status).toBe(200);
  return /name="request" value="([^"]+)"/.exec(await response.text())![1]!;
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("Location")!);
}

// Google, answered by a stub

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey;
const idClaims: { override: Record<string, unknown>; signWith?: CryptoKey; refreshToken: string | null; calls: string[] } = {
  override: {},
  refreshToken: "google-refresh-secret",
  calls: [],
};

const b64 = (data: string | Uint8Array): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

async function idToken(email: string, nonce: string): Promise<string> {
  const header = b64(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64(
    JSON.stringify({
      iss: GOOGLE,
      aud: env.GOOGLE_CLIENT_ID,
      sub: `sub-${email}`,
      email,
      email_verified: true,
      iat: now,
      exp: now + 3600,
      nonce,
      ...idClaims.override,
    }),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", idClaims.signWith ?? keys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64(new Uint8Array(signature))}`;
}

// The stub's codes are "code:<email>:<nonce>".
function stubGoogle(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    idClaims.calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: GOOGLE,
        authorization_endpoint: `${GOOGLE}/authorize`,
        token_endpoint: `${GOOGLE}/token`,
        jwks_uri: `${GOOGLE}/jwks`,
      });
    }
    if (url.pathname === "/jwks") return Response.json({ keys: [{ ...publicJwk, kid: "k1", alg: "RS256", use: "sig" }] });
    if (url.pathname === "/token") {
      const form = new URLSearchParams(init?.body as URLSearchParams);
      if (form.get("client_secret") !== env.GOOGLE_CLIENT_SECRET || form.get("redirect_uri") !== `${BASE}/callback`) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      const [, email, nonce] = form.get("code")!.split(":") as [string, string, string];
      return Response.json({
        access_token: "google-access",
        id_token: await idToken(email, nonce),
        ...(idClaims.refreshToken === null ? {} : { refresh_token: idClaims.refreshToken }),
      });
    }
    return new Response("unexpected", { status: 500 });
  });
}

// Runs the flow up to Google's redirect and returns the callback URL Google would send the browser to.
async function loginAs(email: string, clientId: string): Promise<{ callback: string; google: URL }> {
  const approved = await consent(await pendingId(clientId), "approve");
  const google = location(approved);
  const state = google.searchParams.get("state")!;
  return { google, callback: `/callback?code=${encodeURIComponent(`code:${email}:${google.searchParams.get("nonce")}`)}&state=${state}` };
}

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
  idClaims.override = {};
  idClaims.signWith = undefined;
  idClaims.refreshToken = "google-refresh-secret";
  idClaims.calls = [];
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discovery", () => {
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

describe("POST /register", () => {
  test("registers a public client", async () => {
    const response = await register({ redirect_uris: [REDIRECT, "https://app.test/cb"], client_name: "My <b>client</b>" });
    expect(response.status).toBe(201);
    const body = await response.json<Record<string, unknown>>();
    expect(String(body.client_id).length).toBeGreaterThanOrEqual(16);
    expect(Number.isInteger(body.client_id_issued_at)).toBe(true);
    expect(body).toMatchObject({
      client_name: "My <b>client</b>",
      redirect_uris: [REDIRECT, "https://app.test/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    const row = await env.DB.prepare("SELECT client_name FROM oauth_clients WHERE client_id = ?").bind(body.client_id).first();
    expect(row).toEqual({ client_name: "My <b>client</b>" });
  });

  test("client_name is left out of the answer when not given", async () => {
    const body = await (await register({ redirect_uris: [REDIRECT] })).json<Record<string, unknown>>();
    expect(Object.hasOwn(body, "client_name")).toBe(false);
  });

  test("a missing, empty or invalid redirect_uris gives invalid_redirect_uri", async () => {
    const bad: unknown[] = [
      {},
      { redirect_uris: [] },
      { redirect_uris: "https://a.test/cb" },
      { redirect_uris: ["http://a.test/cb"] },
      { redirect_uris: ["/relative"] },
      { redirect_uris: ["https://a.test/cb#frag"] },
      { redirect_uris: ["ftp://a.test/cb"] },
      { redirect_uris: [REDIRECT, 3] },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.test/${i}`) },
    ];
    for (const body of bad) {
      const response = await register(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json<{ error: string }>()).error).toBe("invalid_redirect_uri");
    }
  });

  test("http is valid on localhost and 127.0.0.1 only", async () => {
    expect((await register({ redirect_uris: ["http://localhost:3000/cb", "http://127.0.0.1/cb"] })).status).toBe(201);
  });

  test("any other invalid field gives invalid_client_metadata", async () => {
    const bad: unknown[] = [
      { redirect_uris: [REDIRECT], client_name: "x".repeat(201) },
      { redirect_uris: [REDIRECT], client_name: 3 },
      { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" },
      { redirect_uris: [REDIRECT], grant_types: ["password"] },
      { redirect_uris: [REDIRECT], response_types: ["token"] },
      [],
    ];
    for (const body of bad) {
      const response = await register(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json<{ error: string }>()).error).toBe("invalid_client_metadata");
    }
    const notJson = await call("/register", { method: "POST", body: "nope" });
    expect(notJson.status).toBe(400);
    expect((await notJson.json<{ error: string }>()).error).toBe("invalid_client_metadata");
  });

  test("a name of 200 characters and the two grants are accepted", async () => {
    const response = await register({
      redirect_uris: [REDIRECT],
      client_name: "x".repeat(200),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(response.status).toBe(201);
  });
});

describe("GET /authorize", () => {
  test("an unknown client or an unregistered redirect_uri gives a 400 HTML page, never a redirect", async () => {
    const clientId = await newClient();
    const cases = [
      authorizeQuery("unknown"),
      authorizeQuery(clientId, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(clientId, { redirect_uri: "http://127.0.0.1:9/cb?x=1" }),
      authorizeQuery(clientId, { redirect_uri: null }),
      authorizeQuery(clientId, { redirect_uri: null, response_type: "token" }),
      authorizeQuery("unknown", { response_type: "token" }),
      "/authorize",
    ];
    for (const path of cases) {
      const response = await call(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Location")).toBeNull();
    }
  });

  test("each error redirects with error and state, in order", async () => {
    const clientId = await newClient();
    const cases: [Record<string, string | null>, string][] = [
      [{ response_type: "token", code_challenge: null, resource: null, scope: "other" }, "unsupported_response_type"],
      [{ code_challenge: null, resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: "plain", resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: null, resource: null, scope: "other" }, "invalid_request"],
      [{ resource: null, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/other`, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/mcp/`, scope: "other" }, "invalid_target"],
      [{ scope: "other" }, "invalid_scope"],
      [{ scope: "digest other" }, "invalid_scope"],
    ];
    for (const [extra, error] of cases) {
      const target = location(await call(authorizeQuery(clientId, extra)));
      expect(target.origin + target.pathname, JSON.stringify(extra)).toBe(REDIRECT);
      expect(target.searchParams.get("error"), JSON.stringify(extra)).toBe(error);
      expect(target.searchParams.get("state")).toBe("client-state");
    }
  });

  test("an error without a client state carries no state", async () => {
    const target = location(await call(authorizeQuery(await newClient(), { state: null, response_type: "token" })));
    expect(target.searchParams.get("error")).toBe("unsupported_response_type");
    expect(target.searchParams.has("state")).toBe(false);
  });

  test("a valid request shows the consent page and stores a pending authorization", async () => {
    const clientId = await newClient("Evil <script>alert(1)</script> & co");
    const response = await call(authorizeQuery(clientId, { scope: null }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Evil &lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
    expect(html).not.toContain("<script>");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(html).toMatch(/<input type="hidden" name="request" value="[A-Za-z0-9_-]{16,}">/);
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    expect((html.match(/<button type="submit" name="decision"/g) ?? []).length).toBe(2);
    const row = await env.DB.prepare("SELECT * FROM oauth_requests").first<Record<string, string | null>>();
    expect(row).toMatchObject({
      client_id: clientId,
      redirect_uri: REDIRECT,
      client_state: "client-state",
      code_challenge: CHALLENGE,
      scope: "digest",
      resource: `${BASE}/mcp`,
      google_state: null,
      used_at: null,
    });
  });

  test("the client id stands in for a missing client name, escaped", async () => {
    const clientId = await newClient();
    const html = await (await call(authorizeQuery(clientId))).text();
    expect(html).toContain(clientId);
  });
});

describe("POST /authorize/consent", () => {
  test("an unknown, malformed or expired request gives 400 HTML", async () => {
    const clientId = await newClient();
    const id = await pendingId(clientId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?").bind("2020-01-01T00:00:00.000Z", id).run();
    for (const [request, decision] of [["unknown", "approve"], [id, "approve"], [id, "deny"], [id, "maybe"]] as const) {
      const response = await consent(request, decision);
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toContain("text/html");
    }
    const noBody = await call("/authorize/consent", { method: "POST" });
    expect(noBody.status).toBe(400);
  });

  test("deny redirects with access_denied and the client state, and uses the request up", async () => {
    const clientId = await newClient();
    const id = await pendingId(clientId);
    const target = location(await consent(id, "deny"));
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect((await consent(id, "deny")).status).toBe(400);
    expect((await consent(id, "approve")).status).toBe(400);
  });

  test("approve redirects to Google with every parameter", async () => {
    const clientId = await newClient();
    const id = await pendingId(clientId);
    const target = location(await consent(id, "approve"));
    expect(target.origin + target.pathname).toBe(`${GOOGLE}/authorize`);
    const q = target.searchParams;
    expect(q.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(16);
    expect(q.get("state")).not.toBe(q.get("nonce"));
    expect(q.get("state")).not.toBe(id);
    const row = await env.DB.prepare("SELECT google_state, google_nonce FROM oauth_requests").first();
    expect(row).toEqual({ google_state: q.get("state"), google_nonce: q.get("nonce") });
    expect((await consent(id, "approve")).status).toBe(400);
  });

  test("approve when Google cannot be reached gives a 400 page and keeps the request", async () => {
    const id = await pendingId(await newClient());
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    expect((await consent(id, "approve")).status).toBe(400);
    stubGoogle();
    expect((await consent(id, "approve")).status).toBe(302);
  });
});

describe("GET /callback", () => {
  test("a state that matches nothing, an expired one or a used one gives 400 HTML", async () => {
    const clientId = await newClient();
    expect((await call("/callback?code=x&state=nope")).status).toBe(400);
    expect((await call("/callback?code=x")).status).toBe(400);
    const { callback } = await loginAs("bob@test", clientId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind("2020-01-01T00:00:00.000Z").run();
    const expired = await call(callback);
    expect(expired.status).toBe(400);
    expect(expired.headers.get("Content-Type")).toContain("text/html");
    const again = await loginAs("bob@test", clientId);
    await env.DB.prepare("INSERT INTO invites (email, invited_at, revoked) VALUES ('bob@test', 'x', 0)").run();
    expect((await call(again.callback)).status).toBe(302);
    expect((await call(again.callback)).status).toBe(400);
  });

  test("a bad state does not use up another pending authorization", async () => {
    const { callback } = await loginAs("alice@test", await newClient());
    expect((await call("/callback?code=x&state=bad")).status).toBe(400);
    expect((await call(callback)).status).toBe(302);
  });

  test("an error from Google redirects to the client with access_denied", async () => {
    const { google } = await loginAs("bob@test", await newClient());
    const target = location(await call(`/callback?error=access_denied&state=${google.searchParams.get("state")}`));
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(idClaims.calls.filter((c) => c.includes("/token"))).toEqual([]);
  });

  test("an invited user gets a code, a member row and an accepted invite", async () => {
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "Bob@Test" }) });
    const clientId = await newClient();
    const { callback } = await loginAs("bob@test", clientId);
    const target = location(await call(callback));
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("client-state");
    const code = target.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(32);
    const users = await env.DB.prepare("SELECT user_sub, email, role FROM users").all();
    expect(users.results).toEqual([{ user_sub: "sub-bob@test", email: "bob@test", role: "member" }]);
    expect(await env.DB.prepare("SELECT accepted_user_sub FROM invites").first()).toEqual({ accepted_user_sub: "sub-bob@test" });
    const stored = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, string | null>>();
    expect(stored).toMatchObject({
      client_id: clientId,
      user_sub: "sub-bob@test",
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      scope: "digest",
      resource: `${BASE}/mcp`,
      used_at: null,
    });
    expect(stored!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.code_hash).not.toBe(code);
    const users2 = await (await call("/ops/users", { headers: OPS })).json();
    expect(users2).toEqual({ users: [{ user_sub: "sub-bob@test", email: "bob@test", role: "member" }] });
  });

  test("the admin gets a code without an invite, with the admin role", async () => {
    const { callback } = await loginAs("alice@test", await newClient());
    expect(location(await call(callback)).searchParams.get("code")).not.toBeNull();
    expect((await env.DB.prepare("SELECT role FROM users").first())?.role).toBe("admin");
  });

  test("a non-invited user, or one whose invite is revoked, gets the 403 page and no row", async () => {
    const clientId = await newClient();
    for (const revoked of [false, true]) {
      if (revoked) {
        await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "mallory@test" }) });
        await call("/ops/invites/revoke", { method: "POST", headers: OPS, body: JSON.stringify({ email: "mallory@test" }) });
      }
      const { callback } = await loginAs("mallory@test", clientId);
      const response = await call(callback);
      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Location")).toBeNull();
      const html = await response.text();
      expect(html).toContain("<title>Access refused</title>");
      expect(html).toContain("This account is not invited.");
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first())?.n).toBe(0);
  });

  test("an unverified e-mail is refused, the admin's included", async () => {
    idClaims.override = { email_verified: false };
    const { callback } = await loginAs("alice@test", await newClient());
    expect((await call(callback)).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first())?.n).toBe(0);
  });

  test("the e-mail is compared lowercased", async () => {
    idClaims.override = { email: "ALICE@Test" };
    const { callback } = await loginAs("alice@test", await newClient());
    expect((await call(callback)).status).toBe(302);
  });

  test.each([
    ["a wrong nonce", { nonce: "other" }],
    ["a wrong aud", { aud: "someone-else" }],
    ["a wrong iss", { iss: "http://evil.test" }],
    ["an expired token", { exp: 1 }],
  ])("%s gives server_error", async (_, override) => {
    idClaims.override = override;
    const { callback } = await loginAs("alice@test", await newClient());
    const target = location(await call(callback));
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("server_error");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(target.searchParams.has("code")).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first())?.n).toBe(0);
  });

  test("a bad signature gives server_error", async () => {
    const other = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    idClaims.signWith = other.privateKey;
    const { callback } = await loginAs("alice@test", await newClient());
    expect(location(await call(callback)).searchParams.get("error")).toBe("server_error");
  });

  test("a Google token endpoint that refuses gives server_error", async () => {
    const { callback } = await loginAs("alice@test", await newClient());
    const code = new URL(BASE + callback).searchParams.get("state");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("openid-configuration")
        ? Response.json({ token_endpoint: `${GOOGLE}/token`, jwks_uri: `${GOOGLE}/jwks` })
        : Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    expect(location(await call(`/callback?code=x&state=${code}`)).searchParams.get("error")).toBe("server_error");
  });

  test("the Google refresh token is stored encrypted and nowhere in clear", async () => {
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
    const { callback } = await loginAs("bob@test", await newClient());
    await call(callback);
    const user = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    expect(user!.enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    expect(user!.enc).not.toContain("google-refresh-secret");
    for (const table of ["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(rows.results), table).not.toContain("google-refresh-secret");
    }
    // The ciphertext decrypts with the key, and two encryptions of one value differ.
    const { decryptSecret, encryptSecret } = await import("../../src/secrets");
    expect(await decryptSecret(user!.enc, env.TOKEN_ENC_KEY)).toBe("google-refresh-secret");
    expect(await encryptSecret("x", env.TOKEN_ENC_KEY)).not.toBe(await encryptSecret("x", env.TOKEN_ENC_KEY));
  });

  test("a login without a Google refresh token keeps the one already stored", async () => {
    await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
    const clientId = await newClient();
    await call((await loginAs("bob@test", clientId)).callback);
    const first = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    idClaims.refreshToken = null;
    await call((await loginAs("bob@test", clientId)).callback);
    const second = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    expect(second!.enc).toBe(first!.enc);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first())?.n).toBe(1);
  });
});

describe("log events", () => {
  test("registration, completion and denials are logged without secrets or e-mails", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      await call("/ops/invites", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
      const clientId = await newClient();
      await call((await loginAs("bob@test", clientId)).callback);
      await call((await loginAs("mallory@test", clientId)).callback);
      await consent(await pendingId(clientId), "deny");
      const { google } = await loginAs("bob@test", clientId);
      await call(`/callback?error=access_denied&state=${google.searchParams.get("state")}`);
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((line) => JSON.parse(line) as { event: string; attrs: Record<string, unknown> });
    const pick = (name: string): Record<string, unknown>[] => events.filter((e) => e.event === name).map((e) => e.attrs);
    expect(pick("auth.client.registered")).toEqual([{ client_id: expect.any(String) }]);
    expect(pick("auth.oauth.completed")).toEqual([{ client_id: expect.any(String), role: "member" }]);
    expect(pick("auth.oauth.denied").map((a) => a.reason)).toEqual(["not_invited", "access_denied", "google_error"]);
    const all = lines.join("\n");
    for (const secret of ["bob@test", "mallory@test", "sub-bob", "google-refresh-secret", "code:"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("routes", () => {
  test("wrong methods on the OAuth routes give 404", async () => {
    for (const [method, path] of [["POST", "/authorize"], ["GET", "/register"], ["GET", "/authorize/consent"], ["POST", "/callback"]]) {
      expect((await call(path!, { method })).status, `${method} ${path}`).toBe(404);
    }
  });
});
