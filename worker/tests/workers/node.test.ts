import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import worker from "../../src/index";

const BASE = "http://worker.test";
const OPS = { Authorization: `Bearer ${env.OPS_TOKEN}` };

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), env);
}

function post(path: string, body: unknown, token: string): Promise<Response> {
  return call(path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

async function enroll(nodeId: string): Promise<string> {
  const response = await post("/ops/nodes", { node_id: nodeId, owner_label: `owner of ${nodeId}` }, env.OPS_TOKEN);
  expect(response.status).toBe(200);
  return (await response.json<{ token: string }>()).token;
}

async function enqueue(ids: string[], priority?: number): Promise<{ enqueued: string[]; existing: string[] }> {
  const response = await post("/ops/jobs", priority === undefined ? { video_ids: ids } : { video_ids: ids, priority }, env.OPS_TOKEN);
  expect(response.status).toBe(200);
  return response.json();
}

interface Claim {
  jobs: { video_id: string; lease_id: string; lease_expires_at: string }[];
}

async function claim(token: string, body: unknown = {}): Promise<Claim> {
  const response = await post("/node/claim", body, token);
  expect(response.status).toBe(200);
  return response.json();
}

async function job(id: string): Promise<Record<string, unknown>> {
  const response = await call(`/ops/jobs/${id}`, { headers: OPS });
  expect(response.status).toBe(200);
  return response.json();
}

const id = (n: number): string => `video${String(n).padStart(6, "0")}`;

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toBe("application/json");
  expect((await response.json<{ error: { code: string } }>()).error.code).toBe(code);
}

beforeEach(async () => {
  await call("/ops/reset", { method: "POST", headers: OPS });
});

describe("POST /ops/nodes", () => {
  test("shows the token once and stores only its hash", async () => {
    const response = await post("/ops/nodes", { node_id: "pi-1", owner_label: "Pi" }, env.OPS_TOKEN);
    const body = await response.json<{ node_id: string; owner_label: string; token: string }>();
    expect(body).toMatchObject({ node_id: "pi-1", owner_label: "Pi" });
    expect(body.token).toMatch(/^ytd_node_[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare("SELECT token_hash, state FROM nodes").first<{ token_hash: string; state: string }>();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.token));
    expect(row?.token_hash).toBe(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
    expect(row?.state).toBe("healthy");
  });

  test("an existing node id is 409, a bad body is 400", async () => {
    await enroll("pi-1");
    await expectError(await post("/ops/nodes", { node_id: "pi-1", owner_label: "x" }, env.OPS_TOKEN), 409, "conflict");
    for (const bad of [{ node_id: "Pi", owner_label: "x" }, { node_id: "a", owner_label: "" }, { node_id: "a" }, { node_id: "a", owner_label: "x", more: 1 }]) {
      await expectError(await post("/ops/nodes", bad, env.OPS_TOKEN), 400, "invalid_request");
    }
  });
});

describe("node authentication", () => {
  test.each(["/node/heartbeat", "/node/claim"])("%s is 401 without bearer, with an unknown token and with the operator token", async (path) => {
    await enroll("pi-1");
    await expectError(await call(path, { method: "POST", body: "{}" }), 401, "unauthorized");
    await expectError(await post(path, {}, "ytd_node_unknown"), 401, "unauthorized");
    await expectError(await post(path, {}, env.OPS_TOKEN), 401, "unauthorized");
  });

  test("a revoked node is 401", async () => {
    const token = await enroll("pi-1");
    await env.DB.prepare("UPDATE nodes SET revoked_at = 't', state = 'disabled'").run();
    await expectError(await post("/node/claim", {}, token), 401, "unauthorized");
  });

  test("authentication comes before the body", async () => {
    await expectError(await call("/node/claim", { method: "POST", body: "nope" }), 401, "unauthorized");
  });
});

describe("POST /node/heartbeat", () => {
  test("updates the node and answers healthy, run, 60", async () => {
    const token = await enroll("pi-1");
    const response = await post("/node/heartbeat", { version: "0.1.0", uptime_s: 5, jobs_in_progress: 0 }, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ node_id: "pi-1", state: "healthy", hourly_budget: 60, directive: "run" });
    const row = await env.DB.prepare("SELECT version, last_heartbeat_at FROM nodes").first<{ version: string; last_heartbeat_at: string }>();
    expect(row?.version).toBe("0.1.0");
    expect(row?.last_heartbeat_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test.each([{}, { version: "", uptime_s: 0, jobs_in_progress: 0 }, { version: "v", uptime_s: -1, jobs_in_progress: 0 }, { version: "v", uptime_s: 0, jobs_in_progress: 0, disk_free_ratio: 2 }, { version: "v", uptime_s: 0, jobs_in_progress: 0, extra: 1 }])(
    "invalid body %j is 400",
    async (bad) => {
      const token = await enroll("pi-1");
      await expectError(await post("/node/heartbeat", bad, token), 400, "invalid_request");
    },
  );
});

describe("POST /ops/jobs", () => {
  test("new ids are enqueued, existing ones kept and their priority only raised", async () => {
    expect(await enqueue([id(1), id(2)], 5)).toEqual({ enqueued: [id(1), id(2)], existing: [] });
    expect(await enqueue([id(2), id(3)], 2)).toEqual({ enqueued: [id(3)], existing: [id(2)] });
    expect((await job(id(2))).priority).toBe(5);
    await enqueue([id(2)], 9);
    expect(await job(id(2))).toMatchObject({ priority: 9, status: "queued", attempts: 0, tried_nodes: [], leased_by: null, kind: "primary" });
    expect((await job(id(3))).priority).toBe(2);
  });

  test("invalid bodies are 400 and unknown jobs 404", async () => {
    for (const bad of [{}, { video_ids: [] }, { video_ids: ["short"] }, { video_ids: [id(1)], priority: -1 }, { video_ids: Array.from({ length: 101 }, (_, n) => id(n)) }]) {
      await expectError(await post("/ops/jobs", bad, env.OPS_TOKEN), 400, "invalid_request");
    }
    await expectError(await call(`/ops/jobs/${id(1)}`, { headers: OPS }), 404, "not_found");
  });
});

describe("POST /node/claim", () => {
  test("an empty queue gives no jobs", async () => {
    const token = await enroll("pi-1");
    expect(await claim(token)).toEqual({ jobs: [] });
  });

  test("takes 3 by default, by priority then creation order, and leases them", async () => {
    const token = await enroll("pi-1");
    await enqueue([id(1), id(2)]);
    await enqueue([id(3)]);
    await enqueue([id(4)], 7);
    await enqueue([id(5)], 7);
    const { jobs } = await claim(token);
    expect(jobs.map((j) => j.video_id)).toEqual([id(4), id(5), id(1)]);
    for (const j of jobs) {
      expect(j.lease_id.length).toBeGreaterThanOrEqual(16);
      expect(j.lease_expires_at).toMatch(/Z$/);
    }
    expect(await job(id(4))).toMatchObject({ status: "leased", attempts: 1, tried_nodes: ["pi-1"], leased_by: "pi-1", lease_expires_at: jobs[0]!.lease_expires_at });
    expect(await job(id(2))).toMatchObject({ status: "queued", attempts: 0 });
    const leases = await env.DB.prepare("SELECT lease_id, video_id, node_id, state FROM leases ORDER BY video_id").all();
    expect(leases.results).toHaveLength(3);
    expect(leases.results.every((l) => l.node_id === "pi-1" && l.state === "active")).toBe(true);
  });

  test("lease expiry is now plus LEASE_SECONDS", async () => {
    const token = await enroll("pi-1");
    await enqueue([id(1)]);
    const before = Date.now();
    const { jobs } = await claim(token, { max_jobs: 1 });
    const expires = Date.parse(jobs[0]!.lease_expires_at);
    expect(expires).toBeGreaterThanOrEqual(before + 600_000);
    expect(expires).toBeLessThan(Date.now() + 600_000 + 1);
  });

  test("honours max_jobs and rejects invalid values", async () => {
    const token = await enroll("pi-1");
    await enqueue(Array.from({ length: 12 }, (_, n) => id(n)));
    expect((await claim(token, { max_jobs: 10 })).jobs).toHaveLength(10);
    expect((await claim(token, { max_jobs: 1 })).jobs).toHaveLength(1);
    for (const bad of [{ max_jobs: 0 }, { max_jobs: 11 }, { max_jobs: 1.5 }, { max_jobs: "2" }, { other: 1 }]) {
      await expectError(await post("/node/claim", bad, token), 400, "invalid_request");
    }
  });

  test("a node in tried_nodes is not given the job again", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue([id(1)]);
    await claim(one);
    await env.DB.prepare("UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL").run();
    expect(await claim(one)).toEqual({ jobs: [] });
    expect((await claim(two)).jobs.map((j) => j.video_id)).toEqual([id(1)]);
    expect(await job(id(1))).toMatchObject({ attempts: 2, tried_nodes: ["pi-1", "pi-2"] });
  });

  test("leased, done and failed jobs are not handed out", async () => {
    const token = await enroll("pi-1");
    await enqueue([id(1), id(2), id(3)]);
    await env.DB.prepare("UPDATE jobs SET status = 'done' WHERE video_id = ?").bind(id(1)).run();
    await env.DB.prepare("UPDATE jobs SET status = 'failed_video' WHERE video_id = ?").bind(id(2)).run();
    expect((await claim(token)).jobs.map((j) => j.video_id)).toEqual([id(3)]);
    expect(await claim(token)).toEqual({ jobs: [] });
  });

  test("concurrent claims hand out no job twice and none comes back short", async () => {
    const tokens = await Promise.all(["a", "b", "c", "d"].map((n) => enroll(`node-${n}`)));
    await enqueue(Array.from({ length: 20 }, (_, n) => id(n)));
    const results = await Promise.all(tokens.map((token) => claim(token, { max_jobs: 4 })));
    expect(results.map((r) => r.jobs.length)).toEqual([4, 4, 4, 4]);
    const all = results.flatMap((r) => r.jobs.map((j) => j.video_id));
    expect(new Set(all).size).toBe(16);

    // More demand than supply: 4 jobs left, 4 nodes asking for 3 each.
    const rest = await Promise.all(tokens.map((token) => claim(token, { max_jobs: 3 })));
    const sizes = rest.map((r) => r.jobs.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4);
    expect(new Set([...all, ...rest.flatMap((r) => r.jobs.map((j) => j.video_id))]).size).toBe(20);
    const leases = await env.DB.prepare("SELECT COUNT(*) AS n FROM leases").first<{ n: number }>();
    expect(leases?.n).toBe(20);
  });

  test("each claim gets min(max_jobs, eligible) under contention", async () => {
    const tokens = await Promise.all(["a", "b", "c"].map((n) => enroll(`node-${n}`)));
    await enqueue(Array.from({ length: 9 }, (_, n) => id(n)));
    const results = await Promise.all(tokens.map((token) => claim(token)));
    expect(results.map((r) => r.jobs.length)).toEqual([3, 3, 3]);
  });
});
