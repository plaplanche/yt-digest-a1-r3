import { expect, test, type APIRequestContext } from "@playwright/test";
import { reset } from "./support";

const redirectUri = "http://127.0.0.1:9/cb";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

async function registerClient(request: APIRequestContext): Promise<{ client_id: string; resource: string }> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  const resource = ((await (await request.get("/.well-known/oauth-protected-resource")).json()) as { resource: string }).resource;
  return { client_id: ((await res.json()) as { client_id: string }).client_id, resource };
}

function authorizeUrl(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return `/authorize?${query}`;
}

test("E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const { client_id, resource } = await registerClient(request);
  const valid = { response_type: "code", client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", resource, state: "s1" };

  const noPkce = await request.get(authorizeUrl({ ...valid, code_challenge: undefined, code_challenge_method: undefined }), { maxRedirects: 0 });
  expect(noPkce.status()).toBe(302);
  const noPkceTarget = new URL(noPkce.headers().location!);
  expect(noPkceTarget.origin + noPkceTarget.pathname).toBe(redirectUri);
  expect(noPkceTarget.searchParams.get("error")).toBe("invalid_request");
  expect(noPkceTarget.searchParams.get("state")).toBe("s1");

  const plain = await request.get(authorizeUrl({ ...valid, code_challenge_method: "plain" }), { maxRedirects: 0 });
  expect(plain.status()).toBe(302);
  expect(new URL(plain.headers().location!).searchParams.get("error")).toBe("invalid_request");

  for (const wrong of [`${redirectUri}/`, "http://127.0.0.1:9/other", "http://127.0.0.1:9/cb?x=1", "https://evil.test/cb"]) {
    const res = await request.get(authorizeUrl({ ...valid, redirect_uri: wrong }), { maxRedirects: 0 });
    expect(res.status(), wrong).toBe(400);
    expect(res.headers().location).toBeUndefined();
    expect(res.headers()["content-type"]).toContain("text/html");
  }

  const ok = await request.get(authorizeUrl(valid), { maxRedirects: 0 });
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('name="decision"');
});
