import { sha256Hex } from "./hash";
import { json, type Env } from "./http";
import { log } from "./log";
import { isObject } from "./validate";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";

const base = (env: Env): string => (env.PUBLIC_URL ?? "").replace(/\/+$/, "");
const nowIso = (): string => new Date().toISOString();
const inSeconds = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

function ttl(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function oauthError(status: number, error: string, description: string): Response {
  return json({ error, error_description: description }, status);
}

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function html(status: number, title: string, body: string): Response {
  const page = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>\n${body}\n</body></html>\n`;
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const errorPage = (message: string): Response => html(400, "Authorization error", `<h1>Authorization error</h1><p>${escapeHtml(message)}</p>`);

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function redirectTo(uri: string, params: Record<string, string | null | undefined>): Response {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return redirect(url.toString());
}

// 10.1

function discovery(env: Env): Response {
  const BASE = base(env);
  return json({
    issuer: BASE,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    registration_endpoint: `${BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

function protectedResource(env: Env): Response {
  const BASE = base(env);
  return json({
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}

// 10.2

function validRedirectUri(value: unknown): boolean {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function isSubset(value: unknown, allowed: string[]): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.includes(item));
}

async function register(request: Request, env: Env): Promise<Response> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    data = undefined;
  }
  if (!isObject(data)) return oauthError(400, "invalid_request", "The body must be a JSON object");
  const uris = data.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid redirect URIs");
  }
  const name = data.client_name;
  const invalid = (field: string): Response => oauthError(400, "invalid_client_metadata", `Invalid ${field}`);
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) return invalid("client_name");
  if (data.token_endpoint_auth_method !== undefined && data.token_endpoint_auth_method !== "none") {
    return invalid("token_endpoint_auth_method");
  }
  if (data.grant_types !== undefined && !isSubset(data.grant_types, ["authorization_code", "refresh_token"])) {
    return invalid("grant_types");
  }
  if (data.response_types !== undefined && !isSubset(data.response_types, ["code"])) return invalid("response_types");

  const clientId = randomToken(24);
  const now = new Date();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, name ?? null, JSON.stringify(uris), now.toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id: clientId } });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(name === undefined ? {} : { client_name: name }),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

// 10.3

interface Client {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
}

interface PendingRequest {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
  google_state: string | null;
  google_nonce: string | null;
}

async function authorize(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const client =
    clientId === null
      ? null
      : await env.DB.prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
          .bind(clientId)
          .first<Client>();
  if (client === null) return errorPage("Unknown client.");
  const redirectUri = q.get("redirect_uri");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage("The redirect URI is not registered for this client.");
  }
  const state = q.get("state");
  const fail = (error: string): Response => redirectTo(redirectUri, { error, state });
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const resource = `${base(env)}/mcp`;
  if (q.get("resource") !== resource) return fail("invalid_target");
  const scope = q.get("scope") ?? SCOPE;
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken(24);
  await env.DB.prepare(
    "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(requestId, client.client_id, redirectUri, state, challenge, scope, resource, inSeconds(ttl(env.AUTH_REQUEST_TTL_SECONDS, 600)))
    .run();
  return html(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> wants to access your yt-digest account.</p>
<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p>
<p>Scope: <code>${escapeHtml(scope)}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}

async function googleEndpoints(env: Env): Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string }> {
  const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("google discovery failed");
  const doc: unknown = await response.json();
  if (!isObject(doc)) throw new Error("google discovery invalid");
  const { authorization_endpoint, token_endpoint, jwks_uri } = doc;
  if (typeof authorization_endpoint !== "string" || typeof token_endpoint !== "string" || typeof jwks_uri !== "string") {
    throw new Error("google discovery incomplete");
  }
  return { authorization_endpoint, token_endpoint, jwks_uri };
}

async function consent(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage("Invalid request.");
  }
  const requestId = form.get("request");
  const decision = form.get("decision");
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage("Invalid request.");

  const now = nowIso();
  // A pending authorization is consumed by a denial, and bound to Google's state by an approval, only once.
  const pending =
    decision === "deny"
      ? await env.DB.prepare(
          "UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL AND google_state IS NULL AND expires_at > ? RETURNING *",
        )
          .bind(now, requestId, now)
          .first<PendingRequest>()
      : await env.DB.prepare(
          "UPDATE oauth_requests SET google_state = ?, google_nonce = ? WHERE request_id = ? AND used_at IS NULL AND google_state IS NULL AND expires_at > ? RETURNING *",
        )
          .bind(randomToken(), randomToken(), requestId, now)
          .first<PendingRequest>();
  if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");

  if (decision === "deny") {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return redirectTo(pending.redirect_uri, { error: "access_denied", state: pending.client_state });
  }
  try {
    const { authorization_endpoint } = await googleEndpoints(env);
    return redirectTo(authorization_endpoint, {
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${base(env)}/callback`,
      response_type: "code",
      scope: GOOGLE_SCOPE,
      state: pending.google_state,
      nonce: pending.google_nonce,
      access_type: "offline",
      prompt: "consent",
    });
  } catch {
    await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ?").bind(now, requestId).run();
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason: "google_error" } });
    return redirectTo(pending.redirect_uri, { error: "server_error", state: pending.client_state });
  }
}

// 10.4

interface Identity {
  sub: string;
  email: string;
  emailVerified: boolean;
  refreshToken: string | null;
}

function decodeJson(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  if (!isObject(value)) throw new Error("not an object");
  return value;
}

async function verifyIdToken(env: Env, idToken: string, jwksUri: string, nonce: string): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed id token");
  const [h, c, s] = parts as [string, string, string];
  const header = decodeJson(h);
  if (header.alg !== "RS256") throw new Error("unexpected alg");
  const response = await fetch(jwksUri);
  if (!response.ok) throw new Error("jwks unavailable");
  const jwks: unknown = await response.json();
  const keys = isObject(jwks) && Array.isArray(jwks.keys) ? jwks.keys.filter(isObject) : [];
  const jwk = keys.find((key) => key.kid === header.kid);
  if (jwk === undefined) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(s), new TextEncoder().encode(`${h}.${c}`));
  if (!valid) throw new Error("bad signature");
  const claims = decodeJson(c);
  const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
  const aud = claims.aud;
  if (typeof claims.iss !== "string" || claims.iss.replace(/\/+$/, "") !== issuer) throw new Error("bad iss");
  if (aud !== env.GOOGLE_CLIENT_ID && !(Array.isArray(aud) && aud.includes(env.GOOGLE_CLIENT_ID))) throw new Error("bad aud");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("expired");
  if (claims.nonce !== nonce) throw new Error("bad nonce");
  return claims;
}

async function googleIdentity(env: Env, code: string, nonce: string): Promise<Identity> {
  const { token_endpoint, jwks_uri } = await googleEndpoints(env);
  const response = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${base(env)}/callback`,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });
  if (!response.ok) throw new Error("google token exchange failed");
  const tokens: unknown = await response.json();
  if (!isObject(tokens) || typeof tokens.id_token !== "string") throw new Error("no id token");
  const claims = await verifyIdToken(env, tokens.id_token, jwks_uri, nonce);
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new Error("incomplete id token");
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
  };
}

async function encrypt(env: Env, plain: string): Promise<string> {
  const raw = Uint8Array.from(atob(env.TOKEN_ENC_KEY ?? ""), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv);
  joined.set(cipher, iv.length);
  return `v1:${btoa(String.fromCharCode(...joined))}`;
}

function refusal(): Response {
  return html(403, "Access refused", "<h1>Access refused</h1><p>This account is not invited.</p>");
}

async function callback(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const state = q.get("state");
  const now = nowIso();
  const pending =
    state === null || state === ""
      ? null
      : await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE google_state = ? AND used_at IS NULL AND expires_at > ? RETURNING *")
          .bind(now, state, now)
          .first<PendingRequest>();
  if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");

  const deny = (reason: "access_denied" | "google_error", error: string): Response => {
    log("auth.oauth.denied", { level: reason === "google_error" ? "warn" : "info", attrs: { client_id: pending.client_id, reason } });
    return redirectTo(pending.redirect_uri, { error, state: pending.client_state });
  };
  if (q.get("error") !== null) return deny("access_denied", "access_denied");

  const code = q.get("code");
  let identity: Identity;
  try {
    if (code === null || code === "") throw new Error("no code");
    identity = await googleIdentity(env, code, pending.google_nonce ?? "");
  } catch {
    return deny("google_error", "server_error");
  }

  const refuse = (reason: "not_invited" | "email_unverified"): Response => {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return refusal();
  };
  if (!identity.emailVerified) return refuse("email_unverified");
  let role: "admin" | "member";
  if (identity.email === (env.ADMIN_EMAIL ?? "").toLowerCase()) {
    role = "admin";
  } else {
    const invite = await env.DB.prepare("SELECT email FROM invites WHERE email = ? AND revoked = 0").bind(identity.email).first();
    if (invite === null) return refuse("not_invited");
    role = "member";
  }

  const encrypted = identity.refreshToken === null ? null : await encrypt(env, identity.refreshToken);
  const authCode = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_sub) DO UPDATE SET email = excluded.email, role = excluded.role,
         google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc)`,
    ).bind(identity.sub, identity.email, role, encrypted, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ?").bind(identity.sub, identity.email),
    env.DB.prepare(
      "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      await sha256Hex(authCode),
      pending.client_id,
      identity.sub,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      inSeconds(ttl(env.AUTH_CODE_TTL_SECONDS, 60)),
    ),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirectTo(pending.redirect_uri, { code: authCode, state: pending.client_state });
}

// 10.5

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

interface TokenRow {
  token_hash: string;
  client_id: string;
  user_sub: string;
  family_id: string;
  scope: string;
  resource: string;
  used_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

// Stores a new access and refresh token pair of a family and builds the 200 answer.
// With `rotated`, the pair is stored in the same batch as the marking of the used refresh token,
// and only if that marking changed a row and the family is not revoked: a concurrent reuse
// detection cannot leave a valid pair behind. Returns null when nothing was stored.
async function issuePair(
  env: Env,
  grantType: string,
  clientId: string,
  userSub: string,
  familyId: string,
  scope: string,
  resource: string,
  rotated?: { hash: string; now: string },
): Promise<Response | null> {
  const accessTtl = ttl(env.ACCESS_TOKEN_TTL_SECONDS, 3600);
  const access = randomToken();
  const refresh = randomToken();
  const values = [clientId, userSub, familyId, scope, resource];
  const accessAt = inSeconds(accessTtl);
  const refreshAt = inSeconds(ttl(env.REFRESH_TOKEN_TTL_SECONDS, 2592000));
  if (rotated === undefined) {
    const insert = "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    await env.DB.batch([
      env.DB.prepare(insert).bind(await sha256Hex(access), "access", ...values, accessAt),
      env.DB.prepare(insert).bind(await sha256Hex(refresh), "refresh", ...values, refreshAt),
    ]);
  } else {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND kind = 'refresh' AND used_at IS NULL AND revoked_at IS NULL")
        .bind(rotated.now, rotated.hash),
      env.DB.prepare(
        `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE family_id = ? AND revoked_at IS NOT NULL)
         UNION ALL
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE family_id = ? AND revoked_at IS NOT NULL)`,
      ).bind(
        await sha256Hex(access), "access", ...values, accessAt, familyId,
        await sha256Hex(refresh), "refresh", ...values, refreshAt, familyId,
      ),
    ]);
    if (results[1]!.meta.changes !== 2) return null;
  }
  log("auth.token.issued", { attrs: { client_id: clientId, grant_type: grantType } });
  return noStore(json({ access_token: access, token_type: "Bearer", expires_in: accessTtl, refresh_token: refresh, scope }));
}

interface CodeRow {
  client_id: string;
  user_sub: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
}

async function codeGrant(form: URLSearchParams, env: Env, clientId: string): Promise<Response> {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const verifier = form.get("code_verifier");
  const resource = form.get("resource");
  if (!code || !redirectUri || !verifier || !resource) return oauthError(400, "invalid_request", "Missing parameter");
  if (resource !== `${base(env)}/mcp`) return oauthError(400, "invalid_target", "Unknown resource");

  const now = nowIso();
  // The code is used up by the first exchange that reaches this check.
  const row = await env.DB.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL RETURNING *")
    .bind(now, await sha256Hex(code))
    .first<CodeRow>();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  if (row === null || row.expires_at <= now || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.code_challenge !== challenge) {
    return oauthError(400, "invalid_grant", "The authorization code is invalid");
  }
  return (await issuePair(env, "authorization_code", clientId, row.user_sub, randomToken(), row.scope, row.resource))!;
}

async function refreshGrant(form: URLSearchParams, env: Env, clientId: string): Promise<Response> {
  const refreshToken = form.get("refresh_token");
  if (!refreshToken) return oauthError(400, "invalid_request", "Missing parameter");
  const resource = form.get("resource");
  if (resource !== null && resource !== `${base(env)}/mcp`) return oauthError(400, "invalid_target", "Unknown resource");

  const now = nowIso();
  const hash = await sha256Hex(refreshToken);
  const invalid = () => oauthError(400, "invalid_grant", "The refresh token is invalid");
  const row = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh' AND client_id = ?").bind(hash, clientId).first<TokenRow>();
  if (row === null) return invalid();
  // Revokes the whole family, access tokens included.
  const revokeFamily = async (): Promise<number> =>
    (await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL RETURNING token_hash").bind(now, row.family_id).all()).results.length;
  if (row.used_at !== null) {
    const revoked = await revokeFamily();
    log("auth.refresh.reuse_detected", { level: "warn", attrs: { client_id: clientId, revoked } });
    return invalid();
  }
  if (row.revoked_at !== null || row.expires_at <= now) return invalid();
  const issued = await issuePair(env, "refresh_token", clientId, row.user_sub, row.family_id, row.scope, row.resource, { hash, now });
  if (issued !== null) return issued;
  // Nothing was stored: a concurrent request used the token or revoked the family first.
  const revoked = await revokeFamily();
  if (revoked > 0) log("auth.refresh.reuse_detected", { level: "warn", attrs: { client_id: clientId, revoked } });
  return invalid();
}

async function token(request: Request, env: Env): Promise<Response> {
  if ((request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return noStore(oauthError(400, "invalid_request", "The body must be form-encoded"));
  }
  const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return noStore(oauthError(400, "unsupported_grant_type", "Unsupported grant type"));
  }
  const clientId = form.get("client_id");
  const client = clientId ? await env.DB.prepare("SELECT client_id FROM oauth_clients WHERE client_id = ?").bind(clientId).first() : null;
  if (clientId === null || client === null) return noStore(oauthError(401, "invalid_client", "Unknown client"));
  return noStore(await (grantType === "authorization_code" ? codeGrant(form, env, clientId) : refreshGrant(form, env, clientId)));
}

// 10.6

export interface AccessUser {
  user_sub: string;
  email: string;
  role: "admin" | "member";
}

export type AccessCheck = { ok: true; user: AccessUser } | { ok: false; reason: "missing" | "unknown" | "expired" | "revoked" };

// The user is read again on every call, so that revoking an invite refuses their tokens at once.
export async function checkAccessToken(request: Request, env: Env): Promise<AccessCheck> {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get("Authorization") ?? "");
  if (match === null) return { ok: false, reason: "missing" };
  const row = await env.DB.prepare("SELECT user_sub, resource, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'")
    .bind(await sha256Hex(match[1]!))
    .first<{ user_sub: string; resource: string; expires_at: string; revoked_at: string | null }>();
  if (row === null || row.resource !== `${base(env)}/mcp`) return { ok: false, reason: "unknown" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.expires_at <= nowIso()) return { ok: false, reason: "expired" };
  const user = await env.DB.prepare("SELECT user_sub, email FROM users WHERE user_sub = ?").bind(row.user_sub).first<{ user_sub: string; email: string }>();
  if (user === null) return { ok: false, reason: "revoked" };
  if (user.email.toLowerCase() === (env.ADMIN_EMAIL ?? "").toLowerCase()) return { ok: true, user: { ...user, role: "admin" } };
  const invite = await env.DB.prepare("SELECT email FROM invites WHERE email = ? AND revoked = 0").bind(user.email.toLowerCase()).first();
  return invite === null ? { ok: false, reason: "revoked" } : { ok: true, user: { ...user, role: "member" } };
}

export async function handleOAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    switch (path) {
      case "/.well-known/oauth-protected-resource":
      case "/.well-known/oauth-protected-resource/mcp":
        return protectedResource(env);
      case "/.well-known/oauth-authorization-server":
        return discovery(env);
      case "/authorize":
        return authorize(url, env);
      case "/callback":
        return callback(url, env);
    }
  } else if (request.method === "POST") {
    if (path === "/register") return register(request, env);
    if (path === "/token") return token(request, env);
    if (path === "/authorize/consent") return consent(request, env);
  }
  return null;
}

