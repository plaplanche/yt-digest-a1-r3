import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import worker from "../../src/index";

const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`http://worker.test${path}`, init), env);
}

function post(path: string, body: unknown): Promise<Response> {
  return call(path, { method: "POST", headers: OPS, body: JSON.stringify(body) });
}

async function revoked(email: string): Promise<number | undefined> {
  const row = await env.DB.prepare("SELECT revoked FROM invites WHERE email = ?").bind(email).first<{ revoked: number }>();
  return row?.revoked;
}

beforeEach(async () => {
  expect((await call("/ops/reset", { method: "POST", headers: OPS })).status).toBe(200);
});

describe("invites", () => {
  test("an invite is stored lowercased", async () => {
    const response = await post("/ops/invites", { email: "Bob@Test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: "bob@test", revoked: false });
    expect(await revoked("bob@test")).toBe(0);
    expect(await revoked("Bob@Test")).toBeUndefined();
  });

  test("inviting again re-activates a revoked invite", async () => {
    await post("/ops/invites", { email: "bob@test" });
    const revokedResponse = await post("/ops/invites/revoke", { email: "BOB@test" });
    expect(await revokedResponse.json()).toEqual({ email: "bob@test", revoked: true });
    expect(await revoked("bob@test")).toBe(1);
    const again = await post("/ops/invites", { email: "bob@test" });
    expect(await again.json()).toEqual({ email: "bob@test", revoked: false });
    expect(await revoked("bob@test")).toBe(0);
  });

  test("revoking an unknown invite gives 404 not_found", async () => {
    const response = await post("/ops/invites/revoke", { email: "nobody@test" });
    expect(response.status).toBe(404);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("not_found");
  });

  test("an e-mail without @ or an extra field gives 400 invalid_request", async () => {
    for (const body of [{ email: "bob" }, { email: 3 }, { email: "a@b", extra: 1 }, {}]) {
      const response = await post("/ops/invites", body);
      expect(response.status).toBe(400);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe("invalid_request");
    }
  });

  test("the endpoints need the operator bearer", async () => {
    const response = await call("/ops/users");
    expect(response.status).toBe(401);
  });
});

describe("GET /ops/users", () => {
  test("lists users sorted by e-mail", async () => {
    const insert = env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES (?, ?, ?, ?)");
    await env.DB.batch([
      insert.bind("g-2", "bob@test", "member", "2026-10-22T00:00:00.000Z"),
      insert.bind("g-1", "alice@test", "admin", "2026-10-22T00:00:00.000Z"),
      insert.bind("g-3", "carol@test", "member", "2026-10-22T00:00:00.000Z"),
    ]);
    const response = await call("/ops/users", { headers: OPS });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      users: [
        { user_sub: "g-1", email: "alice@test", role: "admin" },
        { user_sub: "g-2", email: "bob@test", role: "member" },
        { user_sub: "g-3", email: "carol@test", role: "member" },
      ],
    });
  });

  test("lists nothing when there is no user", async () => {
    expect(await (await call("/ops/users", { headers: OPS })).json()).toEqual({ users: [] });
  });
});
