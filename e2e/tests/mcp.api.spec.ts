import { expect, test } from "@playwright/test";
import { bearer, enroll, mcp, mcpLogin, ops, reset } from "./support";

test.beforeEach(async ({ request }) => reset(request));

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

test("E2E-27: /mcp without token gets 401 and WWW-Authenticate; discovery documents are served and consistent", async ({ request, baseURL }) => {
  const res = await mcp(request, null, ping);
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_token");
  const header = res.headers()["www-authenticate"]!;
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)![1]!;
  expect(metadataUrl).toBe(`${baseURL}/.well-known/oauth-protected-resource`);

  const resource = await request.get(metadataUrl);
  expect(resource.status()).toBe(200);
  const metadata = (await resource.json()) as { resource: string; authorization_servers: string[] };
  expect(metadata.resource).toBe(`${baseURL}/mcp`);
  const issuer = metadata.authorization_servers[0]!;
  const server = await request.get(`${issuer}/.well-known/oauth-authorization-server`);
  expect(server.status()).toBe(200);
  const doc = (await server.json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
  expect(doc.issuer).toBe(issuer);
  for (const endpoint of [doc.authorization_endpoint, doc.token_endpoint, doc.registration_endpoint]) expect(endpoint.startsWith(issuer)).toBe(true);
});

test("E2E-33: a revoked invite refuses the user's valid access token", async ({ request }) => {
  const { accessToken } = await mcpLogin(request, "bob@test");
  const list = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } };
  const ok = await mcp(request, accessToken, list);
  expect(ok.status()).toBe(200);
  expect(((await ok.json()) as { result: { isError: boolean } }).result.isError).toBe(false);

  const revoked = await request.post("/ops/invites/revoke", { headers: ops, data: { email: "bob@test" } });
  expect(revoked.status()).toBe(200);
  const after = await mcp(request, accessToken, list);
  expect(after.status()).toBe(401);
  expect(after.headers()["www-authenticate"]).toContain("resource_metadata=");
});

test("E2E-37: a node token on /mcp and an access token on /node/* are refused", async ({ request }) => {
  const nodeToken = await enroll(request, "n1");
  const { accessToken } = await mcpLogin(request, "bob@test");

  expect((await mcp(request, nodeToken, ping)).status()).toBe(401);
  expect((await mcp(request, ops.Authorization.slice(7), ping)).status()).toBe(401);
  expect((await mcp(request, accessToken, ping)).status()).toBe(200);

  const claim = await request.post("/node/claim", { headers: bearer(accessToken), data: { max_jobs: 1 } });
  expect(claim.status()).toBe(401);
});
