import { expect, test, type APIRequestContext } from "@playwright/test";
import { ops, reset } from "./support";

const redirectUri = "http://127.0.0.1:9/cb";

test.beforeEach(async ({ request }) => reset(request));

async function register(request: APIRequestContext): Promise<{ client_id: string; base: string }> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  const base = new URL(res.url()).origin;
  return { client_id: ((await res.json()) as { client_id: string }).client_id, base };
}

function authorizeUrl(clientId: string, base: string, extra: Record<string, string | null> = {}): string {
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
    state: "st-1",
    ...extra,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, value);
  return `/authorize?${query}`;
}

test("E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const { client_id, base } = await register(request);

  const bad: Record<string, string | null>[] = [{ code_challenge: null }, { code_challenge_method: "plain" }, { code_challenge_method: null }];
  for (const extra of bad) {
    const res = await request.get(authorizeUrl(client_id, base, extra), { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = new URL(res.headers().location!);
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("st-1");
  }

  for (const uri of [`${redirectUri}/`, `${redirectUri}?x=1`, "http://127.0.0.1:9/other", "https://evil.example/cb"]) {
    const res = await request.get(authorizeUrl(client_id, base, { redirect_uri: uri }), { maxRedirects: 0 });
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();
    expect(res.headers()["content-type"]).toContain("text/html");
  }
});

test("the consent page, then the fake Google sign-in, lead an invited user back to the client with a code", async ({ request }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  const { client_id, base } = await register(request);

  const page = await request.get(authorizeUrl(client_id, base));
  expect(page.status()).toBe(200);
  const html = await page.text();
  expect(html).toContain("E2E client");
  const requestId = /name="request" value="([^"]+)"/.exec(html)![1]!;

  const approve = await request.post("/authorize/consent", { form: { request: requestId, decision: "approve" }, maxRedirects: 0 });
  expect(approve.status()).toBe(302);
  const googleUrl = new URL(approve.headers().location!);
  expect(googleUrl.pathname).toBe("/google/authorize");

  const signIn = await request.get(googleUrl.toString());
  expect(signIn.status()).toBe(200);
  expect(await signIn.text()).toContain('name="login_hint"');

  googleUrl.searchParams.set("login_hint", "bob@test");
  const back = await request.get(googleUrl.toString(), { maxRedirects: 0 });
  expect(back.status()).toBe(302);
  const callbackUrl = new URL(back.headers().location!);
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(`${base}/callback`);

  const done = await request.get(callbackUrl.toString(), { maxRedirects: 0 });
  expect(done.status()).toBe(302);
  const finalUrl = new URL(done.headers().location!);
  expect(finalUrl.origin + finalUrl.pathname).toBe(redirectUri);
  expect(finalUrl.searchParams.get("code")!.length).toBeGreaterThanOrEqual(32);
  expect(finalUrl.searchParams.get("state")).toBe("st-1");

  const users = await request.get("/ops/users", { headers: ops });
  expect(((await users.json()) as { users: { email: string; role: string }[] }).users).toEqual([
    expect.objectContaining({ email: "bob@test", role: "member" }),
  ]);
});
