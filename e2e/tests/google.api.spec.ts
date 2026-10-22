import { createHash, createPublicKey, verify } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;
const issuer = `${mocksUrl}/google`;
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const redirectUri = "http://127.0.0.1:9/callback";

function authorizeUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", ...params });
  return `${issuer}/authorize?${query}`;
}

async function getCode(request: APIRequestContext, params: Record<string, string> = {}): Promise<string> {
  const res = await request.get(authorizeUrl({ login_hint: "Bob@Test", state: "st-1", ...params }), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers().location!);
  expect(location.origin + location.pathname).toBe(redirectUri);
  expect(location.searchParams.get("state")).toBe("st-1");
  return location.searchParams.get("code")!;
}

function exchange(request: APIRequestContext, form: Record<string, string>, headers: Record<string, string> = {}) {
  return request.post(`${issuer}/token`, { form, headers });
}

const withClient = { client_id: clientId, client_secret: clientSecret };

function decode(jwt: string): { header: Record<string, string>; claims: Record<string, unknown>; ok: (jwk: object) => boolean } {
  const [h, c, s] = jwt.split(".") as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()) as Record<string, string>,
    claims: JSON.parse(Buffer.from(c, "base64url").toString()) as Record<string, unknown>,
    ok: (jwk) =>
      verify("RSA-SHA256", Buffer.from(`${h}.${c}`), createPublicKey({ key: jwk as never, format: "jwk" }), Buffer.from(s, "base64url")),
  };
}

test("the discovery document lists the endpoints", async ({ request }) => {
  const res = await request.get(`${issuer}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

test("authorize refuses a wrong client_id and a missing openid scope", async ({ request }) => {
  expect((await request.get(authorizeUrl({ client_id: "other" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ scope: "email" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ response_type: "token" }))).status()).toBe(400);
});

test("authorize without login_hint shows a form repeating every parameter", async ({ request }) => {
  const res = await request.get(authorizeUrl({ state: "s&1", nonce: "n1" }));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  const html = await res.text();
  expect(html).toContain('<form method="get" action="/google/authorize">');
  for (const [name, value] of [["client_id", clientId], ["redirect_uri", redirectUri], ["response_type", "code"], ["scope", "openid email"], ["state", "s&amp;1"], ["nonce", "n1"]]) {
    expect(html).toContain(`<input type="hidden" name="${name}" value="${value}">`);
  }
  expect(html).toContain('name="login_hint"');
  expect(html).toContain('type="submit"');
});

test("the code gives a verifiable ID token with the claims of 5.3", async ({ request }) => {
  const code = await getCode(request, { nonce: "nonce-1" });
  const before = Math.floor(Date.now() / 1000);
  const res = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...withClient });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "openid email" });
  expect(body.refresh_token).toBeUndefined();
  const jwks = (await (await request.get(`${issuer}/jwks`)).json()) as { keys: Record<string, string>[] };
  expect(jwks.keys).toHaveLength(1);
  const key = jwks.keys[0]!;
  expect(key).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
  const token = decode(body.id_token as string);
  expect(token.header).toMatchObject({ alg: "RS256", kid: key.kid });
  expect(token.ok(key)).toBe(true);
  const sub = `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`;
  expect(token.claims).toMatchObject({ iss: issuer, aud: clientId, sub, email: "bob@test", email_verified: true, nonce: "nonce-1" });
  const iat = token.claims.iat as number;
  expect(iat).toBeGreaterThanOrEqual(before - 5);
  expect(iat).toBeLessThanOrEqual(before + 10);
  expect(token.claims.exp).toBe(iat + 3600);
});

test("a tampered ID token does not verify and no nonce means no claim", async ({ request }) => {
  const code = await getCode(request);
  const res = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...withClient });
  const idToken = ((await res.json()) as { id_token: string }).id_token;
  const key = ((await (await request.get(`${issuer}/jwks`)).json()) as { keys: object[] }).keys[0]!;
  const parts = idToken.split(".");
  const forged = Buffer.from(JSON.stringify({ ...decode(idToken).claims, email: "mallory@test" })).toString("base64url");
  expect(decode([parts[0], forged, parts[2]].join(".")).ok(key)).toBe(false);
  expect(decode(idToken).claims).not.toHaveProperty("nonce");
});

test("the code is single use and bound to its redirect_uri", async ({ request }) => {
  const code = await getCode(request);
  const wrong = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: "http://127.0.0.1:9/other", ...withClient });
  expect(wrong.status()).toBe(400);
  expect(await wrong.json()).toEqual({ error: "invalid_grant" });
  const fresh = await getCode(request);
  const form = { grant_type: "authorization_code", code: fresh, redirect_uri: redirectUri, ...withClient };
  expect((await exchange(request, form)).status()).toBe(200);
  const second = await exchange(request, form);
  expect(second.status()).toBe(400);
  expect(await second.json()).toEqual({ error: "invalid_grant" });
});

test("a wrong client secret gives 401 invalid_client; Basic authentication works", async ({ request }) => {
  const code = await getCode(request);
  const form = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
  const bad = await exchange(request, { ...form, client_id: clientId, client_secret: "nope" });
  expect(bad.status()).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid_client" });
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  expect((await exchange(request, form, { Authorization: basic })).status()).toBe(200);
});

test("access_type=offline gives a refresh token that issues new tokens", async ({ request }) => {
  const code = await getCode(request, { access_type: "offline" });
  const first = (await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...withClient })).json()) as Record<string, string>;
  expect(first.refresh_token).toBeTruthy();
  const res = await exchange(request, { grant_type: "refresh_token", refresh_token: first.refresh_token!, ...withClient });
  expect(res.status()).toBe(200);
  const next = (await res.json()) as Record<string, string>;
  expect(next.access_token).not.toBe(first.access_token);
  expect(decode(next.id_token!).claims.email).toBe("bob@test");
  const bad = await exchange(request, { grant_type: "refresh_token", refresh_token: "unknown", ...withClient });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_grant" });
});

test("userinfo answers for its access token only", async ({ request }) => {
  const code = await getCode(request);
  const { access_token: accessToken } = (await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...withClient })).json()) as { access_token: string };
  const ok = await request.get(`${issuer}/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(ok.status()).toBe(200);
  const sub = `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`;
  expect(await ok.json()).toEqual({ sub, email: "bob@test", email_verified: true });
  expect((await request.get(`${issuer}/userinfo`, { headers: { Authorization: "Bearer other" } })).status()).toBe(401);
  expect((await request.get(`${issuer}/userinfo`)).status()).toBe(401);
});

test("revoke answers 200", async ({ request }) => {
  expect((await request.post(`${issuer}/revoke`, { form: { token: "x" } })).status()).toBe(200);
});
