import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import pkg from "../../package.json";
import worker from "../../src/index";

const BASE = "http://worker.test";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };

function call(path: string, init: RequestInit = {}, withEnv = env): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), withEnv);
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toBe("application/json");
  const body = await response.json<{ error: { code: string; message: string } }>();
  expect(Object.keys(body)).toEqual(["error"]);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
}

const COLUMNS: Record<string, string[]> = {
  nodes: [
    "node_id", "owner_label", "token_hash", "state", "state_since", "last_heartbeat_at",
    "version", "hourly_budget", "created_at", "revoked_at",
  ],
  jobs: [
    "video_id", "kind", "priority", "status", "leased_by", "lease_id", "lease_expires_at",
    "attempts", "tried_nodes", "last_outcome", "created_at", "done_at",
  ],
  leases: ["lease_id", "video_id", "node_id", "issued_at", "expires_at", "state", "response_json"],
  node_events: ["node_id", "ts", "kind", "video_id"],
  invites: ["email", "invited_at", "accepted_user_sub", "revoked"],
  users: ["user_sub", "email", "role", "google_refresh_token_enc", "created_at"],
  oauth_clients: ["client_id", "client_name", "redirect_uris", "created_at"],
  oauth_requests: [
    "request_id", "client_id", "redirect_uri", "client_state", "code_challenge", "scope",
    "resource", "google_state", "google_nonce", "expires_at", "used_at",
  ],
  oauth_codes: [
    "code_hash", "client_id", "user_sub", "redirect_uri", "code_challenge", "scope", "resource",
    "expires_at", "used_at",
  ],
  oauth_tokens: [
    "token_hash", "kind", "client_id", "user_sub", "family_id", "scope", "resource", "expires_at",
    "used_at", "revoked_at",
  ],
};

describe("migrations", () => {
  test.each(Object.entries(COLUMNS))("table %s has its columns", async (table, columns) => {
    const info = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
    const names = info.results.map((row) => row.name);
    for (const column of columns) {
      expect(names).toContain(column);
    }
  });

  test("defaults and keys", async () => {
    await env.DB.prepare(
      "INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')",
    ).run();
    const node = await env.DB.prepare("SELECT hourly_budget FROM nodes").first<{ hourly_budget: number }>();
    expect(node?.hourly_budget).toBe(60);
    const insertJob = env.DB.prepare(
      "INSERT INTO jobs (video_id, kind, status, created_at) VALUES ('dQw4w9WgXcQ', 'primary', 'queued', 't')",
    );
    await insertJob.run();
    await expect(insertJob.run()).rejects.toThrow();
    await env.DB.prepare("DELETE FROM nodes").run();
    await env.DB.prepare("DELETE FROM jobs").run();
  });
});

describe("HTTP conventions", () => {
  test("GET /health", async () => {
    const response = await call("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: "ok", version: pkg.version });
  });

  test.each([
    ["GET", "/nope"],
    ["POST", "/health"],
    ["GET", "/node/claim"],
    ["GET", "/"],
  ])("%s %s is 404 not_found", async (method, path) => {
    await expectError(await call(path, { method }), 404, "not_found");
  });
});

describe("operator authentication", () => {
  const routes: [string, string][] = [
    ["POST", "/ops/reset"],
    ["POST", "/ops/nodes"],
    ["GET", "/ops/users"],
    ["GET", "/ops/anything"],
  ];

  test.each(routes)("%s %s without bearer is 401", async (method, path) => {
    await expectError(await call(path, { method }), 401, "unauthorized");
  });

  test.each(routes)("%s %s with a wrong bearer is 401, whatever the body", async (method, path) => {
    for (const body of [undefined, "not json", '{"node_id": 1}']) {
      const init: RequestInit = { method, headers: { Authorization: "Bearer wrong" } };
      if (method === "POST") init.body = body;
      await expectError(await call(path, init), 401, "unauthorized");
    }
  });

  test("a non-bearer scheme or a prefix of the token is 401", async () => {
    await expectError(await call("/ops/reset", { method: "POST", headers: { Authorization: `Basic ${env.OPS_TOKEN}` } }), 401, "unauthorized");
    await expectError(await call("/ops/reset", { method: "POST", headers: { Authorization: `Bearer ${env.OPS_TOKEN.slice(0, -1)}` } }), 401, "unauthorized");
    await expectError(await call("/ops/reset", { method: "POST", headers: { Authorization: `Bearer ${env.OPS_TOKEN}x` } }), 401, "unauthorized");
  });

  test.each(["", undefined])("/ops/* is 404 when OPS_TOKEN is %j", async (token) => {
    const bare = { ...env, OPS_TOKEN: token } as unknown as typeof env;
    for (const headers of [OPS, {}, { Authorization: "Bearer " }]) {
      await expectError(await call("/ops/reset", { method: "POST", headers }, bare), 404, "not_found");
    }
    await expectError(await call("/ops/users", {}, bare), 404, "not_found");
  });

  test("an authenticated unknown /ops route is 404", async () => {
    await expectError(await call("/ops/unknown", { headers: OPS }), 404, "not_found");
    await expectError(await call("/ops/reset", { headers: OPS }), 404, "not_found");
  });
});

describe("POST /ops/reset", () => {
  beforeEach(async () => {
    await call("/ops/reset", { method: "POST", headers: OPS });
  });

  test("empties every table and every transcript, and nothing else", async () => {
    const statements = [
      "INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')",
      "INSERT INTO jobs (video_id, kind, status, created_at) VALUES ('dQw4w9WgXcQ', 'primary', 'queued', 't')",
      "INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state) VALUES ('l', 'v', 'n', 't', 't', 'active')",
      "INSERT INTO node_events (node_id, ts, kind) VALUES ('n', 't', 'job_ok')",
      "INSERT INTO invites (email, invited_at) VALUES ('a@test', 't')",
      "INSERT INTO users (user_sub, email, role, created_at) VALUES ('s', 'a@test', 'admin', 't')",
      "INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES ('c', '[]', 't')",
      "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES ('r', 'c', 'u', 'x', 'digest', 'r', 't')",
      "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES ('h', 'c', 's', 'u', 'x', 'digest', 'r', 't')",
      "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES ('h', 'access', 'c', 's', 'f', 'digest', 'r', 't')",
    ];
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
    for (let i = 0; i < 1100; i++) {
      await env.TRANSCRIPTS.put(`transcripts/v${i}.json`, "{}");
    }
    await env.TRANSCRIPTS.put("other/keep.json", "{}");

    const response = await call("/ops/reset", { method: "POST", headers: OPS });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    for (const table of Object.keys(COLUMNS)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
    expect((await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects).toHaveLength(0);
    expect((await env.TRANSCRIPTS.list({ prefix: "other/" })).objects).toHaveLength(1);
    await env.TRANSCRIPTS.delete("other/keep.json");
  });

  test("is idempotent on empty storage", async () => {
    const response = await call("/ops/reset", { method: "POST", headers: OPS });
    expect(response.status).toBe(200);
  });
});
