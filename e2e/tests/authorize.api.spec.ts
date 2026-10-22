import { expect, test } from "@playwright/test";
import { authorizeUrl, registerClient, reset } from "./support";

const redirectUri = "https://client.example/cb";

test.beforeEach(async ({ request }) => reset(request));

// E2E-29
test("no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const clientId = await registerClient(request, redirectUri);
  const get = (path: string) => request.get(path, { maxRedirects: 0 });

  const noPkce = new URLSearchParams(authorizeUrl(clientId, redirectUri).split("?")[1]);
  noPkce.delete("code_challenge");
  noPkce.delete("code_challenge_method");
  const missing = await get(`/authorize?${noPkce}`);
  expect(missing.status()).toBe(302);
  const missingTo = new URL(missing.headers().location!);
  expect(missingTo.origin + missingTo.pathname).toBe(redirectUri);
  expect(missingTo.searchParams.get("error")).toBe("invalid_request");
  expect(missingTo.searchParams.get("state")).toBe("st-e2e");

  const plain = await get(authorizeUrl(clientId, redirectUri, { code_challenge_method: "plain" }));
  expect(plain.status()).toBe(302);
  expect(new URL(plain.headers().location!).searchParams.get("error")).toBe("invalid_request");

  for (const wrong of [`${redirectUri}/`, "https://client.example/cb2", "https://evil.example/cb"]) {
    const res = await get(authorizeUrl(clientId, wrong));
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();
  }

  const ok = await get(authorizeUrl(clientId, redirectUri));
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('name="decision"');
});
