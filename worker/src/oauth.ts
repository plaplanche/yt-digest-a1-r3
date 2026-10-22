import { sha256Hex } from "./hash";
import { json, type Env } from "./http";
import { log } from "./log";
import { consentPage, errorPage, refusalPage } from "./pages";
import { encryptSecret, randomToken, verifyIdToken } from "./secrets";
import { isObject } from "./validate";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const GRANTS = ["authorization_code", "refresh_token"];

const base = (env: Env): string => env.PUBLIC_URL.replace(/\/+$/, "");

function seconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

const after = (ms: number): string => new Date(Date.now() + ms).toISOString();

function oauthError(status: number, error: string, description?: string): Response {
  return json(description === undefined ? { error } : { error, error_description: description }, status);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

// The client's redirect URI with the given parameters, and its `state` when it sent one.
function clientRedirect(redirectUri: string, state: string | null, params: Record<string, string>): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (state !== null) url.searchParams.set("state", state);
  return redirect(url.toString());
}

// Discovery (10.1)

function protectedResource(env: Env): Response {
  return json({
    resource: `${base(env)}/mcp`,
    authorization_servers: [base(env)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}

function authorizationServer(env: Env): Response {
  const url = base(env);
  return json({
    issuer: url,
    authorization_endpoint: `${url}/authorize`,
    token_endpoint: `${url}/token`,
    registration_endpoint: `${url}/register`,
    response_types_supported: ["code"],
    grant_types_supported: GRANTS,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

// Dynamic client registration (10.2)

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
}

function onlyOf(value: unknown, allowed: string[]): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.includes(item));
}

async function register(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "The body is not JSON");
  }
  if (!isObject(body)) {
    return oauthError(400, "invalid_client_metadata", "The body is not an object");
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid redirect URIs");
  }
  const name = body.client_name;
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) {
    return oauthError(400, "invalid_client_metadata", "client_name must be a string of up to 200 characters");
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    return oauthError(400, "invalid_client_metadata", "Only token_endpoint_auth_method none is supported");
  }
  if (body.grant_types !== undefined && !onlyOf(body.grant_types, GRANTS)) {
    return oauthError(400, "invalid_client_metadata", "Unsupported grant_types");
  }
  if (body.response_types !== undefined && !onlyOf(body.response_types, ["code"])) {
    return oauthError(400, "invalid_client_metadata", "Only response_types code is supported");
  }
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
      grant_types: GRANTS,
      response_types: ["code"],
    },
    201,
  );
}

// Authorization request and consent (10.3)

interface Client {
  client_name: string | null;
  redirect_uris: string;
}

async function authorize(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  const client =
    clientId === null
      ? null
      : await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<Client>();
  if (clientId === null || client === null) {
    return errorPage("Unknown client.");
  }
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage("The redirect URI is not registered for this client.");
  }
  const state = q.get("state");
  const fail = (error: string): Response => clientRedirect(redirectUri, state, { error });
  const challenge = q.get("code_challenge");
  const scope = q.get("scope") ?? SCOPE;
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  if (q.get("resource") !== `${base(env)}/mcp`) return fail("invalid_target");
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken(24);
  await env.DB.prepare(
    `INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(requestId, clientId, redirectUri, state, challenge, scope, `${base(env)}/mcp`, after(seconds(env.AUTH_REQUEST_TTL_SECONDS, 600) * 1000))
    .run();
  return consentPage(requestId, client.client_name ?? clientId, redirectUri, scope);
}

interface Pending {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
  google_nonce: string | null;
}

async function discovery(env: Env): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(`${env.GOOGLE_ISSUER.replace(/\/+$/, "")}/.well-known/openid-configuration`);
    const body: unknown = await response.json();
    return response.ok && isObject(body) ? body : undefined;
  } catch {
    return undefined;
  }
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
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) {
    return errorPage("Invalid request.");
  }
  const now = new Date().toISOString();
  if (decision === "deny") {
    const pending = await env.DB.prepare(
      "UPDATE oauth_requests SET used_at = ?2 WHERE request_id = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING *",
    )
      .bind(requestId, now)
      .first<Pending>();
    if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return clientRedirect(pending.redirect_uri, pending.client_state, { error: "access_denied" });
  }
  const open = await env.DB.prepare(
    "SELECT 1 AS found FROM oauth_requests WHERE request_id = ?1 AND used_at IS NULL AND google_state IS NULL AND expires_at > ?2",
  )
    .bind(requestId, now)
    .first();
  if (open === null) return errorPage("This authorization request is unknown, expired or already used.");
  const endpoint = (await discovery(env))?.authorization_endpoint;
  if (typeof endpoint !== "string") {
    return errorPage("The login provider is unavailable.");
  }
  const googleState = randomToken(24);
  const nonce = randomToken(24);
  const updated = await env.DB.prepare(
    `UPDATE oauth_requests SET google_state = ?2, google_nonce = ?3
     WHERE request_id = ?1 AND used_at IS NULL AND google_state IS NULL AND expires_at > ?4 RETURNING request_id`,
  )
    .bind(requestId, googleState, nonce, now)
    .first();
  if (updated === null) return errorPage("This authorization request is unknown, expired or already used.");
  const target = new URL(endpoint);
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${base(env)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return redirect(target.toString());
}

// Google callback and access control (10.4)

interface GoogleIdentity {
  sub: string;
  email: string;
  verified: boolean;
  refreshToken: string | null;
}

// Exchanges the code and verifies the ID token; undefined on any failure.
async function googleLogin(env: Env, code: string, nonce: string): Promise<GoogleIdentity | undefined> {
  try {
    const config = await discovery(env);
    if (config === undefined || typeof config.token_endpoint !== "string" || typeof config.jwks_uri !== "string") return undefined;
    const tokenResponse = await fetch(config.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${base(env)}/callback`,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }),
    });
    const tokens: unknown = await tokenResponse.json();
    if (!tokenResponse.ok || !isObject(tokens) || typeof tokens.id_token !== "string") return undefined;
    const jwksResponse = await fetch(config.jwks_uri);
    const jwks: unknown = await jwksResponse.json();
    if (!jwksResponse.ok || !isObject(jwks) || !Array.isArray(jwks.keys)) return undefined;
    const claims = await verifyIdToken(tokens.id_token, {
      issuer: env.GOOGLE_ISSUER,
      audience: env.GOOGLE_CLIENT_ID,
      nonce,
      keys: jwks.keys as JsonWebKey[],
      nowSeconds: Date.now() / 1000,
    });
    if (claims === undefined || typeof claims.sub !== "string" || claims.sub === "" || typeof claims.email !== "string") return undefined;
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      verified: claims.email_verified === true,
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    };
  } catch {
    return undefined;
  }
}

async function callback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get("state");
  const now = new Date().toISOString();
  const pending =
    state === null || state === ""
      ? null
      : await env.DB.prepare("UPDATE oauth_requests SET used_at = ?2 WHERE google_state = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING *")
          .bind(state, now)
          .first<Pending>();
  if (pending === null) {
    return errorPage("This login is unknown, expired or already used.");
  }
  const denied = (reason: string): void => log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason } });
  const refuse = (error: string): Response => clientRedirect(pending.redirect_uri, pending.client_state, { error });
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error")) {
    denied("google_error");
    return refuse("access_denied");
  }
  const identity = code === null ? undefined : await googleLogin(env, code, pending.google_nonce ?? "");
  if (identity === undefined) {
    denied("google_error");
    return refuse("server_error");
  }

  const isAdmin = identity.email === env.ADMIN_EMAIL.toLowerCase();
  const invited =
    (await env.DB.prepare("SELECT 1 AS found FROM invites WHERE email = ? AND revoked = 0").bind(identity.email).first()) !== null;
  if (!identity.verified || (!isAdmin && !invited)) {
    denied(identity.verified ? "not_invited" : "email_unverified");
    return refusalPage();
  }
  const role = isAdmin ? "admin" : "member";
  const encrypted = identity.refreshToken === null ? null : await encryptSecret(identity.refreshToken, env.TOKEN_ENC_KEY);
  const authCode = randomToken(32);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_sub) DO UPDATE SET email = excluded.email, role = excluded.role,
         google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, google_refresh_token_enc)`,
    ).bind(identity.sub, identity.email, role, encrypted, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ? AND revoked = 0").bind(identity.sub, identity.email),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await sha256Hex(authCode),
      pending.client_id,
      identity.sub,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      after(seconds(env.AUTH_CODE_TTL_SECONDS, 60) * 1000),
    ),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return clientRedirect(pending.redirect_uri, pending.client_state, { code: authCode });
}

// Returns undefined for a route that is not an OAuth route of this ticket.
export async function handleOAuth(request: Request, env: Env, path: string): Promise<Response | undefined> {
  const get = request.method === "GET";
  if (get && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
    return protectedResource(env);
  }
  if (get && path === "/.well-known/oauth-authorization-server") return authorizationServer(env);
  if (request.method === "POST" && path === "/register") return register(request, env);
  if (get && path === "/authorize") return authorize(new URL(request.url), env);
  if (request.method === "POST" && path === "/authorize/consent") return consent(request, env);
  if (get && path === "/callback") return callback(new URL(request.url), env);
  return undefined;
}
