import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";
import { checkAccessToken } from "../../src/oauth";
import { sha256Hex } from "../../src/hash";

const BASE = "http://worker.test";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };
const REDIRECT = "http://127.0.0.1:9/cb";
const VERIFIER = "verifier-verifier-verifier-verifier-0123456789";
// BASE64URL(SHA-256(VERIFIER)), computed once below.
let challenge = "";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), env);
}

function token(params: Record<string, string | undefined>, contentType = "application/x-www-form-urlencoded"): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, value);
  return call("/token", { method: "POST", headers: { "Content-Type": contentType }, body });
}

interface Pair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

let clientId = "";
let codeCounter = 0;

async function seedUser(email: string, sub = `sub-${email}`): Promise<string> {
  await env.DB.prepare("INSERT OR REPLACE INTO users (user_sub, email, role, created_at) VALUES (?, ?, 'member', ?)").bind(sub, email, new Date().toISOString()).run();
  return sub;
}

async function seedCode(options: { client?: string; expiresInMs?: number; user?: string } = {}): Promise<string> {
  const code = `code-${++codeCounter}-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, 'digest', ?, ?)",
  )
    .bind(await sha256Hex(code), options.client ?? clientId, options.user ?? "sub-bob@test", REDIRECT, challenge, `${BASE}/mcp`, new Date(Date.now() + (options.expiresInMs ?? 60000)).toISOString())
    .run();
  return code;
}

function exchange(code: string, extra: Record<string, string | undefined> = {}): Promise<Response> {
  return token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: `${BASE}/mcp`, ...extra });
}

function refresh(refreshToken: string, extra: Record<string, string | undefined> = {}): Promise<Response> {
  return token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, ...extra });
}

async function pair(): Promise<Pair> {
  const response = await exchange(await seedCode());
  expect(response.status).toBe(200);
  return response.json<Pair>();
}

async function check(accessToken: string | null) {
  const headers: Record<string, string> = accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` };
  return checkAccessToken(new Request(`${BASE}/mcp`, { headers }), env);
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect((await response.json<{ error: string }>()).error).toBe(error);
}

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
  challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER)))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  clientId = (await (await call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json<{ client_id: string }>()).client_id;
  await seedUser("bob@test");
  await env.DB.prepare("INSERT INTO invites (email, invited_at, revoked) VALUES ('bob@test', ?, 0)").bind(new Date().toISOString()).run();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /token, authorization_code (10.5)", () => {
  test("a valid exchange answers the tokens with no-store", async () => {
    const response = await exchange(await seedCode());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<Pair>();
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("digest");
    expect(body.expires_in).toBe(3600);
    expect(body.access_token.length).toBeGreaterThanOrEqual(32);
    expect(body.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(body.access_token).not.toBe(body.refresh_token);
    const stored = await env.DB.prepare("SELECT kind, resource FROM oauth_tokens ORDER BY kind").all<{ kind: string; resource: string }>();
    expect(stored.results).toEqual([{ kind: "access", resource: `${BASE}/mcp` }, { kind: "refresh", resource: `${BASE}/mcp` }]);
    const clear = await env.DB.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash IN (?, ?)").bind(body.access_token, body.refresh_token).first();
    expect(clear).toBeNull();
  });

  test("unknown client: 401 invalid_client; unknown or missing grant type: 400", async () => {
    await expectError(await exchange(await seedCode(), { client_id: "nope" }), 401, "invalid_client");
    await expectError(await exchange(await seedCode(), { client_id: undefined }), 401, "invalid_client");
    await expectError(await token({ grant_type: "password", client_id: clientId }), 400, "unsupported_grant_type");
    await expectError(await token({ client_id: clientId }), 400, "unsupported_grant_type");
    // The grant type is checked before the client.
    await expectError(await token({ grant_type: "password", client_id: "nope" }), 400, "unsupported_grant_type");
  });

  test.each(["code", "redirect_uri", "code_verifier", "resource"])("a missing %s is invalid_request", async (name) => {
    const response = await exchange(await seedCode(), { [name]: undefined });
    await expectError(response, 400, "invalid_request");
  });

  test("a wrong resource is invalid_target and does not use the code", async () => {
    const code = await seedCode();
    await expectError(await exchange(code, { resource: `${BASE}/other` }), 400, "invalid_target");
    expect((await exchange(code)).status).toBe(200);
  });

  test("a missing parameter is reported before a wrong resource", async () => {
    await expectError(await exchange(await seedCode(), { code_verifier: undefined, resource: "x" }), 400, "invalid_request");
  });

  test("invalid_grant: unknown, wrong verifier, other client, other redirect_uri", async () => {
    await expectError(await exchange("unknown-code"), 400, "invalid_grant");
    await expectError(await exchange(await seedCode(), { code_verifier: "wrong" }), 400, "invalid_grant");
    const other = (await (await call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json<{ client_id: string }>()).client_id;
    await expectError(await exchange(await seedCode(), { client_id: other }), 400, "invalid_grant");
    await expectError(await exchange(await seedCode(), { redirect_uri: `${REDIRECT}2` }), 400, "invalid_grant");
  });

  test("an expired code and a used code are invalid_grant", async () => {
    await expectError(await exchange(await seedCode({ expiresInMs: -1000 })), 400, "invalid_grant");
    const code = await seedCode();
    expect((await exchange(code)).status).toBe(200);
    await expectError(await exchange(code), 400, "invalid_grant");
  });

  test("a code is used up by a failed exchange", async () => {
    const code = await seedCode();
    await expectError(await exchange(code, { code_verifier: "wrong" }), 400, "invalid_grant");
    await expectError(await exchange(code), 400, "invalid_grant");
  });

  test("a body that is not form-encoded is invalid_request", async () => {
    const body = JSON.stringify({ grant_type: "authorization_code" });
    for (const type of ["application/json", "text/plain"]) {
      const response = await call("/token", { method: "POST", headers: { "Content-Type": type }, body });
      await expectError(response, 400, "invalid_request");
    }
    await expectError(await call("/token", { method: "POST", body }), 400, "invalid_request");
  });

  test("errors carry no-store too", async () => {
    expect((await exchange("unknown-code")).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /token, refresh_token (10.5)", () => {
  test("a refresh rotates both tokens and earlier access tokens stay valid", async () => {
    const first = await pair();
    const response = await refresh(first.refresh_token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const second = await response.json<Pair>();
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await check(first.access_token)).ok).toBe(true);
    expect((await check(second.access_token)).ok).toBe(true);
    const families = await env.DB.prepare("SELECT DISTINCT family_id FROM oauth_tokens").all();
    expect(families.results).toHaveLength(1);
    expect((await refresh(second.refresh_token, { resource: `${BASE}/mcp` })).status).toBe(200);
  });

  test("the reuse of a used refresh token revokes its family, access tokens included, and is logged", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(JSON.parse(String(line)) as Record<string, unknown>));
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(JSON.parse(String(line)) as Record<string, unknown>));
    const first = await pair();
    const second = await (await refresh(first.refresh_token)).json<Pair>();
    const otherFamily = await pair();

    await expectError(await refresh(first.refresh_token), 400, "invalid_grant");
    for (const t of [first.access_token, second.access_token]) expect(await check(t)).toEqual({ ok: false, reason: "revoked" });
    await expectError(await refresh(second.refresh_token), 400, "invalid_grant");
    expect((await check(otherFamily.access_token)).ok).toBe(true);

    const reuse = lines.find((l) => l.event === "auth.refresh.reuse_detected");
    expect(reuse?.attrs).toEqual({ client_id: clientId, revoked: 4 });
    expect(lines.filter((l) => l.event === "auth.token.issued").map((l) => (l.attrs as { grant_type: string }).grant_type)).toEqual([
      "authorization_code", "refresh_token", "authorization_code",
    ]);
    const all = JSON.stringify(lines);
    for (const secret of [first.access_token, first.refresh_token, second.refresh_token]) expect(all).not.toContain(secret);
  });

  test("unknown, expired, revoked, access and other-client refresh tokens are invalid_grant", async () => {
    const p = await pair();
    await expectError(await refresh("unknown"), 400, "invalid_grant");
    await expectError(await refresh(p.access_token), 400, "invalid_grant");
    const other = (await (await call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json<{ client_id: string }>()).client_id;
    await expectError(await refresh(p.refresh_token, { client_id: other }), 400, "invalid_grant");
    // Another client's attempt neither uses the token nor revokes anything.
    expect((await check(p.access_token)).ok).toBe(true);
    const hash = await sha256Hex(p.refresh_token);
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?").bind(hash).run();
    await expectError(await refresh(p.refresh_token), 400, "invalid_grant");
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = '2999-01-01T00:00:00.000Z', revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), hash).run();
    await expectError(await refresh(p.refresh_token), 400, "invalid_grant");
  });

  test("order and errors: client, missing parameter, resource", async () => {
    const p = await pair();
    await expectError(await refresh(p.refresh_token, { client_id: "nope" }), 401, "invalid_client");
    await expectError(await refresh(""), 400, "invalid_request");
    await expectError(await refresh(p.refresh_token, { resource: `${BASE}/other` }), 400, "invalid_target");
    expect((await refresh(p.refresh_token)).status).toBe(200);
  });
});

describe("access token check (10.6)", () => {
  test("a valid access token is accepted", async () => {
    const p = await pair();
    expect(await check(p.access_token)).toEqual({ ok: true, user: { user_sub: "sub-bob@test", email: "bob@test", role: "member" } });
  });

  test("missing, unknown, refresh and node tokens are refused", async () => {
    const p = await pair();
    expect(await check(null)).toEqual({ ok: false, reason: "missing" });
    expect(await check("unknown")).toEqual({ ok: false, reason: "unknown" });
    expect(await check(p.refresh_token)).toEqual({ ok: false, reason: "unknown" });
    const node = await (await call("/ops/nodes", { method: "POST", headers: OPS, body: JSON.stringify({ node_id: "n1", owner_label: "n1" }) })).json<{ token: string }>();
    expect(await check(node.token)).toEqual({ ok: false, reason: "unknown" });
  });

  test("an expired or revoked token is refused", async () => {
    const p = await pair();
    const hash = await sha256Hex(p.access_token);
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?").bind(hash).run();
    expect(await check(p.access_token)).toEqual({ ok: false, reason: "expired" });
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = '2999-01-01T00:00:00.000Z', revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), hash).run();
    expect(await check(p.access_token)).toEqual({ ok: false, reason: "revoked" });
  });

  test("a token for another resource is refused", async () => {
    const p = await pair();
    await env.DB.prepare("UPDATE oauth_tokens SET resource = 'http://worker.test/other'").run();
    expect(await check(p.access_token)).toEqual({ ok: false, reason: "unknown" });
  });

  test("the token of a user whose invite was revoked is refused at once", async () => {
    const p = await pair();
    expect((await check(p.access_token)).ok).toBe(true);
    const revoked = await call("/ops/invites/revoke", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
    expect(revoked.status).toBe(200);
    expect((await check(p.access_token)).ok).toBe(false);
  });

  test("the admin needs no invite", async () => {
    await seedUser("alice@test");
    const response = await exchange(await seedCode({ user: "sub-alice@test" }));
    const p = await response.json<Pair>();
    expect(await check(p.access_token)).toEqual({ ok: true, user: { user_sub: "sub-alice@test", email: "alice@test", role: "admin" } });
  });
});
