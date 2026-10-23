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
