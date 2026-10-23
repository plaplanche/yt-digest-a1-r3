import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ops, reset } from "./support";

const redirectUri = "http://127.0.0.1:9/cb";

test.beforeEach(async ({ request }) => reset(request));

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ page, request, baseURL }) => {
  const registered = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "Browser client" } });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${baseURL}/mcp`,
    state: "st-2",
  });

  await page.goto(`/authorize?${query}`);
  await expect(page.getByText("Browser client")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();

  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill("mallory@test");
  await page.locator('form button[type="submit"], form input[type="submit"]').first().click();

  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();

  const users = await request.get("/ops/users", { headers: ops });
  expect(await users.json()).toEqual({ users: [] });
});

test("E2E-28: registration, PKCE, resource, consent and fake Google login: the token lists and calls list_subscriptions", async ({ page, request, baseURL }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  const redirect = "http://127.0.0.1:9/cb";
  const registered = await request.post("/register", { data: { redirect_uris: [redirect], client_name: "Browser client" } });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const verifier = "e2e-verifier-e2e-verifier-e2e-verifier-0123456789";
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${baseURL}/mcp`,
    state: "st-28",
  });

  // The client's redirect target does not listen: the code is read from the failed navigation.
  const callback = page.waitForRequest((r) => r.url().startsWith(redirect));
  await page.route(`${redirect}*`, (route) => route.abort());
  await page.goto(`/authorize?${query}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill("bob@test");
  await page.locator('form button[type="submit"], form input[type="submit"]').first().click();
  const returned = new URL((await callback).url());
  expect(returned.searchParams.get("state")).toBe("st-28");

  const issued = await request.post("/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code: returned.searchParams.get("code")!,
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: `${baseURL}/mcp`,
    },
  });
  expect(issued.status()).toBe(200);
  const token = ((await issued.json()) as { access_token: string }).access_token;

  const send = (message: unknown) => request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: message });
  const init = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  expect(((await init.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
  expect((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).status()).toBe(202);
  const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  expect(((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toEqual(["list_subscriptions"]);
  const called = await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } });
  const result = ((await called.json()) as { result: { isError: boolean; content: { text: string }[] } }).result;
  expect(result.isError).toBe(false);
  expect(result.content[0]!.text).toBe('{"subscriptions":[]}');
});
