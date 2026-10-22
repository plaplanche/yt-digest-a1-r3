import { expect, test } from "@playwright/test";
import { ops, reset } from "./support";

test.beforeEach(async ({ request }) => reset(request));

test("invites are lowercased, revocable and re-activable; users start empty", async ({ request }) => {
  const invite = await request.post("/ops/invites", { headers: ops, data: { email: "Bob@Test" } });
  expect(await invite.json()).toEqual({ email: "bob@test", revoked: false });
  const revoked = await request.post("/ops/invites/revoke", { headers: ops, data: { email: "bob@test" } });
  expect(await revoked.json()).toEqual({ email: "bob@test", revoked: true });
  const unknown = await request.post("/ops/invites/revoke", { headers: ops, data: { email: "x@test" } });
  expect(unknown.status()).toBe(404);
  const again = await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  expect(await again.json()).toEqual({ email: "bob@test", revoked: false });
  const users = await request.get("/ops/users", { headers: ops });
  expect(await users.json()).toEqual({ users: [] });
});
