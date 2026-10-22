import { encryptSecret, fromBase64url, randomToken } from "./crypto";
import { sha256Hex } from "./hash";
import { json, type Env } from "./http";
import { log } from "./log";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const HTML = { "Content-Type": "text/html; charset=utf-8" };

interface Config {
  base: string;
  codeTtl: number;
  requestTtl: number;
  googleIssuer: string;
  googleClientId: string;
  googleClientSecret: string;
  adminEmail: string;
  encKey: string;
}

function config(env: Env): Config {
  const need = (value: string | undefined, name: string): string => {
    if (value === undefined || value === "") throw new Error(`missing setting ${name}`);
    return value;
  };
  const seconds = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    base: need(env.PUBLIC_URL, "PUBLIC_URL").replace(/\/+$/, ""),
    codeTtl: seconds(env.AUTH_CODE_TTL_SECONDS, 60),
    requestTtl: seconds(env.AUTH_REQUEST_TTL_SECONDS, 600),
    googleIssuer: need(env.GOOGLE_ISSUER, "GOOGLE_ISSUER"),
    googleClientId: need(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    googleClientSecret: need(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
    adminEmail: need(env.ADMIN_EMAIL, "ADMIN_EMAIL").toLowerCase(),
    encKey: need(env.TOKEN_ENC_KEY, "TOKEN_ENC_KEY"),
  };
}

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>\n`;
  return new Response(html, { status, headers: HTML });
}

const errorPage = (message: string): Response => page(400, "Authorization error", `<h1>Authorization error</h1><p>${escapeHtml(message)}</p>`);

function oauthError(status: number, error: string, description?: string): Response {
  return json(description === undefined ? { error } : { error, error_description: description }, status);
}

function redirectWith(target: string, params: Record<string, string | undefined>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function validRedirectUri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "" || value.includes("#")) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

async function register(request: Request, env: Env): Promise<Response> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return oauthError(400, "invalid_request", "The body is not JSON");
  }
  if (!isObject(data)) return oauthError(400, "invalid_request", "The body is not a JSON object");
  const uris = data.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid URIs");
  }
  const name = data.client_name;
  const invalid = (message: string): Response => oauthError(400, "invalid_client_metadata", message);
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) return invalid("client_name is invalid");
  if (data.token_endpoint_auth_method !== undefined && data.token_endpoint_auth_method !== "none") {
    return invalid("token_endpoint_auth_method must be none");
  }
  const grants = data.grant_types;
  if (grants !== undefined && !(isStringArray(grants) && grants.every((g) => g === "authorization_code" || g === "refresh_token"))) {
    return invalid("grant_types is invalid");
  }
  const types = data.response_types;
  if (types !== undefined && !(isStringArray(types) && types.every((t) => t === "code"))) return invalid("response_types is invalid");

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

interface ClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
}

async function authorize(url: URL, env: Env): Promise<Response> {
  const cfg = config(env);
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const client =
    clientId === null
      ? null
      : await env.DB.prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
          .bind(clientId)
          .first<ClientRow>();
  if (client === null) return errorPage("Unknown client.");
  const redirectUri = q.get("redirect_uri");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage("The redirect URI is not registered for this client.");
  }
  const state = q.get("state") ?? undefined;
  const fail = (error: string): Response => redirectWith(redirectUri, { error, state });
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  if (q.get("resource") !== `${cfg.base}/mcp`) return fail("invalid_target");
  const scope = q.get("scope") ?? SCOPE;
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken(24);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(requestId, client.client_id, redirectUri, state ?? null, challenge, scope, `${cfg.base}/mcp`, new Date(now + cfg.requestTtl * 1000).toISOString())
    .run();
  const body = `<h1>Authorize access</h1>
<p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> wants to access your yt-digest account.</p>
<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p>
<p>Scope: <code>${escapeHtml(scope)}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`;
  return page(200, "Authorize access", body);
}

interface PendingRow {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
  google_nonce: string | null;
}

interface GoogleMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function googleMetadata(cfg: Config): Promise<GoogleMetadata> {
  const res = await fetch(`${cfg.googleIssuer.replace(/\/+$/, "")}/.well-known/openid-configuration`);
  const data: unknown = await res.json();
  if (!res.ok || !isObject(data)) throw new Error("Google discovery failed");
  const { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri } = data;
  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string" || typeof jwksUri !== "string") {
    throw new Error("Google discovery is incomplete");
  }
  return { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri };
}

async function consent(request: Request, env: Env): Promise<Response> {
  const cfg = config(env);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage("Invalid form.");
  }
  const requestId = form.get("request");
  const decision = form.get("decision");
  const now = new Date().toISOString();
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) {
    return errorPage("Invalid form.");
  }
  if (decision === "deny") {
    const row = await env.DB.prepare(
      "UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL AND expires_at > ? RETURNING client_id, redirect_uri, client_state",
    )
      .bind(now, requestId, now)
      .first<{ client_id: string; redirect_uri: string; client_state: string | null }>();
    if (row === null) return errorPage("This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: row.client_id, reason: "access_denied" } });
    return redirectWith(row.redirect_uri, { error: "access_denied", state: row.client_state ?? undefined });
  }
  const pending = await env.DB.prepare("SELECT client_id, redirect_uri, client_state FROM oauth_requests WHERE request_id = ? AND used_at IS NULL AND expires_at > ?")
    .bind(requestId, now)
    .first<{ client_id: string; redirect_uri: string; client_state: string | null }>();
  if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");
  const failed = async (): Promise<Response> => {
    await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL").bind(now, requestId).run();
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason: "google_error" } });
    return redirectWith(pending.redirect_uri, { error: "server_error", state: pending.client_state ?? undefined });
  };
  let meta: GoogleMetadata;
  try {
    meta = await googleMetadata(cfg);
  } catch {
    return failed();
  }
  const googleState = randomToken(24);
  const nonce = randomToken(24);
  const bound = await env.DB.prepare(
    "UPDATE oauth_requests SET google_state = ?, google_nonce = ? WHERE request_id = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(googleState, nonce, requestId, now)
    .run();
  if (bound.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
  return redirectWith(meta.authorization_endpoint, {
    client_id: cfg.googleClientId,
    redirect_uri: `${cfg.base}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce,
    access_type: "offline",
    prompt: "consent",
  });
}

interface IdClaims {
  sub: string;
  email: string;
  email_verified: boolean;
}

// Throws unless the ID token is signed by a key of the JWKS and its claims match what the Worker expects.
async function verifyIdToken(idToken: string, cfg: Config, meta: GoogleMetadata, nonce: string | null): Promise<IdClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed ID token");
  const [head, body, signature] = parts as [string, string, string];
  const decoder = new TextDecoder();
  const header: unknown = JSON.parse(decoder.decode(fromBase64url(head)));
  const claims: unknown = JSON.parse(decoder.decode(fromBase64url(body)));
  if (!isObject(header) || !isObject(claims) || header.alg !== "RS256") throw new Error("unsupported ID token");
  const jwksRes = await fetch(meta.jwks_uri);
  const jwks: unknown = await jwksRes.json();
  if (!jwksRes.ok || !isObject(jwks) || !Array.isArray(jwks.keys)) throw new Error("bad JWKS");
  const jwk = (jwks.keys as unknown[]).find((key): key is JsonWebKey & { kid?: string } => isObject(key) && key.kid === header.kid);
  if (jwk === undefined) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${head}.${body}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signature), signed))) throw new Error("bad signature");
  const aud = claims.aud;
  const audOk = aud === cfg.googleClientId || (Array.isArray(aud) && aud.includes(cfg.googleClientId));
  if (claims.iss !== cfg.googleIssuer || !audOk) throw new Error("wrong issuer or audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("expired");
  if (nonce === null || claims.nonce !== nonce) throw new Error("wrong nonce");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new Error("missing claims");
  return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified === true };
}

function refusalPage(): Response {
  return page(403, "Access refused", "<h1>Access refused</h1><p>This account is not invited.</p>");
}

async function callback(url: URL, env: Env): Promise<Response> {
  const cfg = config(env);
  const q = url.searchParams;
  const state = q.get("state");
  const now = new Date().toISOString();
  const pending =
    state === null || state === ""
      ? null
      : await env.DB.prepare(
          `UPDATE oauth_requests SET used_at = ? WHERE google_state = ? AND used_at IS NULL AND expires_at > ?
           RETURNING client_id, redirect_uri, client_state, code_challenge, scope, resource, google_nonce`,
        )
          .bind(now, state, now)
          .first<PendingRow>();
  if (pending === null) return errorPage("This sign-in is unknown, expired or already used.");
  const clientState = pending.client_state ?? undefined;
  const denied = (reason: "google_error" | "access_denied", error: string): Response => {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason } });
    return redirectWith(pending.redirect_uri, { error, state: clientState });
  };
  if (q.has("error")) return denied("google_error", "access_denied");
  const code = q.get("code");
  if (code === null || code === "") return denied("google_error", "server_error");

  let claims: IdClaims;
  let refreshToken: string | undefined;
  try {
    const meta = await googleMetadata(cfg);
    const tokenRes = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${cfg.base}/callback`,
        client_id: cfg.googleClientId,
        client_secret: cfg.googleClientSecret,
      }),
    });
    const tokens: unknown = await tokenRes.json();
    if (!tokenRes.ok || !isObject(tokens) || typeof tokens.id_token !== "string") throw new Error("token exchange failed");
    claims = await verifyIdToken(tokens.id_token, cfg, meta, pending.google_nonce);
    refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined;
  } catch {
    return denied("google_error", "server_error");
  }

  const email = claims.email.toLowerCase();
  let role: "admin" | "member" | undefined;
  if (claims.email_verified) {
    if (email === cfg.adminEmail) {
      role = "admin";
    } else {
      const invite = await env.DB.prepare("SELECT 1 AS found FROM invites WHERE email = ? AND revoked = 0").bind(email).first();
      if (invite !== null) role = "member";
    }
  }
  if (role === undefined) {
    log("auth.oauth.denied", {
      level: "warn",
      attrs: { client_id: pending.client_id, reason: claims.email_verified ? "not_invited" : "email_unverified" },
    });
    return refusalPage();
  }

  const authCode = randomToken(32);
  const encrypted = refreshToken === undefined ? null : await encryptSecret(refreshToken, cfg.encKey);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_sub) DO UPDATE SET email = excluded.email, role = excluded.role,
         google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, google_refresh_token_enc)`,
    ).bind(claims.sub, email, role, encrypted, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ? AND revoked = 0").bind(claims.sub, email),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await sha256Hex(authCode),
      pending.client_id,
      claims.sub,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      new Date(Date.now() + cfg.codeTtl * 1000).toISOString(),
    ),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirectWith(pending.redirect_uri, { code: authCode, state: clientState });
}

// Discovery, registration, consent and Google login (spec lot 2, sections 10.1 to 10.4); null when the route is not one of them.
export async function handleOAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  const { method } = request;
  const url = new URL(request.url);
  if (method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
    const base = config(env).base;
    return json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
  }
  if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
    const base = config(env).base;
    return json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  }
  if (method === "POST" && path === "/register") return register(request, env);
  if (method === "GET" && path === "/authorize") return authorize(url, env);
  if (method === "POST" && path === "/authorize/consent") return consent(request, env);
  if (method === "GET" && path === "/callback") return callback(url, env);
  return null;
}

