import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ops, reset } from "./support";

const redirectUri = "http://127.0.0.1:9/cb";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const baseUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  // The client's redirect URI answers nothing in the stack: the test only reads the URL the browser is sent to.
  await page.route(`${redirectUri}**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "client" }));
});

async function startAuthorization(request: APIRequestContext, page: Page): Promise<void> {
  const registered = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "Browser <i>client</i>" } });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${baseUrl}/mcp`,
    state: "browser-state",
  });
  await page.goto(`${baseUrl}/authorize?${query}`);
  await expect(page.getByText("Browser <i>client</i>")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByPlaceholder("E-mail").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function users(request: APIRequestContext): Promise<{ user_sub: string; email: string; role: string }[]> {
  const res = await request.get("/ops/users", { headers: ops });
  return ((await res.json()) as { users: { user_sub: string; email: string; role: string }[] }).users;
}

test("the consent page then the Google sign-in lead an invited user back to the client with a code", async ({ request, page }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  await startAuthorization(request, page);
  await signIn(page, "bob@test");
  await page.waitForURL(`${redirectUri}**`);
  const url = new URL(page.url());
  expect(url.searchParams.get("state")).toBe("browser-state");
  expect(url.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  expect(await users(request)).toMatchObject([{ email: "bob@test", role: "member" }]);
});

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ request, page }) => {
  await startAuthorization(request, page);
  await signIn(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  expect(await users(request)).toEqual([]);
});
