import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";
import { sha256Hex } from "../../src/hash";

const BASE = "http://worker.test";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };
const METADATA = `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), env);
}

function rpc(message: unknown, token: string | null, headers: Record<string, string> = {}): Promise<Response> {
  return call("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

async function accessToken(sub = "sub-bob@test", resource = `${BASE}/mcp`): Promise<string> {
  const value = `access-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, 'access', 'c', ?, 'f', 'digest', ?, ?)")
    .bind(await sha256Hex(value), sub, resource, new Date(Date.now() + 60000).toISOString())
    .run();
  return value;
}

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

async function expectRefused(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(METADATA);
  expect((await response.json<{ error: string }>()).error).toBe("invalid_token");
}

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
  await env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('sub-bob@test', 'bob@test', 'member', ?)").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO invites (email, invited_at, revoked) VALUES ('bob@test', ?, 0)").bind(new Date().toISOString()).run();
});

afterEach(() => vi.restoreAllMocks());

describe("authentication", () => {
  test("no token, a malformed one and an unknown one get 401 with WWW-Authenticate", async () => {
    await expectRefused(await rpc(ping, null));
    await expectRefused(await rpc(ping, "unknown"));
    await expectRefused(await call("/mcp", { method: "POST", headers: { Authorization: "Basic abc" }, body: "{}" }));
  });

  test("an expired access token is refused", async () => {
    const token = await accessToken();
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    await expectRefused(await rpc(ping, token));
  });

  test("a node token and the operator token are refused", async () => {
    const node = await (await call("/ops/nodes", { method: "POST", headers: OPS, body: JSON.stringify({ node_id: "n1", owner_label: "n1" }) })).json<{ token: string }>();
    await expectRefused(await rpc(ping, node.token));
    await expectRefused(await rpc(ping, env.OPS_TOKEN as string));
  });

  test("the token of a user whose invite was revoked is refused", async () => {
    const token = await accessToken();
    expect((await rpc(ping, token)).status).toBe(200);
    await call("/ops/invites/revoke", { method: "POST", headers: OPS, body: JSON.stringify({ email: "bob@test" }) });
    await expectRefused(await rpc(ping, token));
  });

  test("an access token is refused on /node/*", async () => {
    const token = await accessToken();
    const response = await call("/node/heartbeat", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ version: "1", jobs_in_progress: 0 }) });
    expect(response.status).toBe(401);
  });

  test("rejections are logged with surface mcp and no token", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    await rpc(ping, "secret-token-value");
    await rpc(ping, null);
    const events = lines.map((line) => JSON.parse(line) as { event: string; attrs: Record<string, unknown> });
    expect(events.map((e) => [e.event, e.attrs])).toEqual([
      ["auth.bearer.rejected", { surface: "mcp", reason: "unknown" }],
      ["auth.bearer.rejected", { surface: "mcp", reason: "missing" }],
    ]);
    expect(lines.join("")).not.toContain("secret-token-value");
  });
});

describe("origin check", () => {
  test("a foreign Origin gets 403 origin_rejected before authentication, and is logged", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const response = await rpc(ping, null, { Origin: "http://evil.test" });
    expect(response.status).toBe(403);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("origin_rejected");
    const event = JSON.parse(lines[0]!) as { event: string; attrs: unknown };
    expect(event).toMatchObject({ event: "auth.origin.rejected", attrs: { origin: "http://evil.test" } });
    expect(lines).toHaveLength(1);
  });

  test("the Worker's origin, an allowed origin and no Origin pass", async () => {
    const token = await accessToken();
    for (const origin of [BASE, "http://allowed.test", "http://other.test", undefined]) {
      const response = await rpc(ping, token, origin === undefined ? {} : { Origin: origin });
      expect(response.status, String(origin)).toBe(200);
    }
    // An allowed origin still needs a token.
    await expectRefused(await rpc(ping, null, { Origin: BASE }));
  });
});

describe("protocol", () => {
  test("initialize answers protocol 2025-06-18", async () => {
    const token = await accessToken();
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json<{ id: number; result: { protocolVersion: string; capabilities: { tools: unknown } } }>();
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  test("a notification gets 202 without a body", async () => {
    const response = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, await accessToken());
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("ping answers an empty result", async () => {
    expect(await (await rpc(ping, await accessToken())).json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  test("tools/list returns exactly list_subscriptions", async () => {
    const body = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, await accessToken())).json<{ result: { tools: { name: string; inputSchema: unknown }[] } }>();
    expect(body.result.tools.map((t) => t.name)).toEqual(["list_subscriptions"]);
    expect(body.result.tools[0]!.inputSchema).toEqual({ type: "object", properties: {} });
  });

  test("tools/call returns the empty list and logs mcp.tool.call", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const body = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } }, await accessToken())).json<{
      result: { isError: boolean; content: { type: string; text: string }[] };
    }>();
    expect(body.result.isError).toBe(false);
    expect(body.result.content).toEqual([{ type: "text", text: '{"subscriptions":[]}' }]);
    const event = JSON.parse(lines[0]!) as { event: string; attrs: { tool: string; outcome: string; duration_ms: number } };
    expect(event.event).toBe("mcp.tool.call");
    expect(event.attrs).toMatchObject({ tool: "list_subscriptions", outcome: "ok" });
    expect(typeof event.attrs.duration_ms).toBe("number");
  });

  test("an unknown tool or method is a JSON-RPC error", async () => {
    const token = await accessToken();
    const tool = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, token)).json<{ error: { code: number } }>();
    expect(tool.error.code).toBe(-32602);
    const method = await (await rpc({ jsonrpc: "2.0", id: 5, method: "nope" }, token)).json<{ error: { code: number } }>();
    expect(method.error.code).toBe(-32601);
  });

  test("a body that is not a JSON object gets 400, and GET gets 404", async () => {
    const token = await accessToken();
    expect((await rpc([ping], token)).status).toBe(400);
    expect((await call("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "x" })).status).toBe(400);
    expect((await call("/mcp", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});
