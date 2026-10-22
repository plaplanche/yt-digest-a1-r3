import { expect, test, type Page } from "@playwright/test";
import { authorizeUrl, invite, ops, registerClient, reset } from "./support";

// Nothing listens here: the test answers the client's callback itself, so the browser never tries to connect.
const redirectUri = "https://client.example/cb";

test.beforeEach(async ({ request }) => reset(request));

async function login(page: Page, clientId: string, email: string): Promise<void> {
  await page.route(`${redirectUri}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>client</p>" }));
  await page.goto(authorizeUrl(clientId, redirectUri));
  await page.locator('button[name="decision"][value="approve"]').click();
  await page.locator('input[name="login_hint"]').fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the consent page then the Google sign-in lead an invited user back to the client with a code", async ({ page, request }) => {
  await invite(request, "bob@test");
  const clientId = await registerClient(request, redirectUri);
  await login(page, clientId, "bob@test");
  await page.waitForURL(`${redirectUri}?**`);
  const url = new URL(page.url());
  expect(url.searchParams.get("state")).toBe("st-e2e");
  expect(url.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  const users = (await (await request.get("/ops/users", { headers: ops })).json()) as { users: { role: string }[] };
  expect(users.users).toHaveLength(1);
  expect(users.users[0]!.role).toBe("member");
});

// E2E-02
test("a non-invited user gets the 403 page and no users row", async ({ page, request }) => {
  const clientId = await registerClient(request, redirectUri);
  await login(page, clientId, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  const users = await (await request.get("/ops/users", { headers: ops })).json();
  expect(users).toEqual({ users: [] });
});
