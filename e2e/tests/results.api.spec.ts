import { expect, test } from "@playwright/test";
import { bearer, claim, enqueue, enroll, job, ops, reset, result } from "./support";

const VIDEO = "e2eresult01";

test("E2E-14: a lease expires, the job goes to another node and the first node's late result is 409", async ({ request }) => {
  await reset(request);
  const [a, b] = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  await enqueue(request, [VIDEO]);
  const [first] = await claim(request, a);
  expect(first?.video_id).toBe(VIDEO);

  // LEASE_SECONDS is 2 in the e2e check.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(await claim(request, a)).toEqual([]);
  const [second] = await claim(request, b);
  expect(second?.video_id).toBe(VIDEO);
  expect(second?.lease_id).not.toBe(first?.lease_id);

  const late = await result(request, a, first!.lease_id, "ok", VIDEO);
  expect(late.status()).toBe(409);
  expect(((await late.json()) as { error: { code: string } }).error.code).toBe("stale_lease");
  expect((await request.get(`/ops/transcripts/${VIDEO}`, { headers: ops })).status()).toBe(404);

  expect((await result(request, b, second!.lease_id, "ok", VIDEO)).status()).toBe(200);
  expect(await job(request, VIDEO)).toMatchObject({ status: "done", attempts: 2, tried_nodes: ["node-a", "node-b"] });
});

test("E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing", async ({ request }) => {
  await reset(request);
  const tokens = await Promise.all(["a", "b", "c", "d"].map((n) => enroll(request, `node-${n}`)));
  await enqueue(request, [VIDEO]);
  for (const [i, token] of tokens.slice(0, 3).entries()) {
    const [leased] = await claim(request, token);
    expect(leased?.video_id).toBe(VIDEO);
    const res = await result(request, token, leased!.lease_id, "unavailable");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ video_id: VIDEO, status: i < 2 ? "queued" : "failed_video" });
  }
  expect(await claim(request, tokens[3]!)).toEqual([]);
  expect(await job(request, VIDEO)).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "unavailable" });
});

test("E2E-20: a revoked node is refused and its job is reassigned", async ({ request }) => {
  await reset(request);
  const [a, b] = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  await enqueue(request, [VIDEO]);
  const [leased] = await claim(request, a);

  const revoked = await request.delete("/ops/nodes/node-a", { headers: ops });
  expect(revoked.status()).toBe(200);
  expect(await revoked.json()).toEqual({ node_id: "node-a", state: "disabled" });
  expect((await request.post("/node/claim", { headers: bearer(a), data: {} })).status()).toBe(401);
  expect((await result(request, a, leased!.lease_id, "ok", VIDEO)).status()).toBe(401);
  expect(await job(request, VIDEO)).toMatchObject({ status: "queued", last_outcome: "lease_revoked", leased_by: null });

  const [again] = await claim(request, b);
  expect(again?.video_id).toBe(VIDEO);
  expect((await result(request, b, again!.lease_id, "ok", VIDEO)).status()).toBe(200);
  expect(await job(request, VIDEO)).toMatchObject({ status: "done", tried_nodes: ["node-a", "node-b"] });
});

test("E2E-21: /node/* responses hold no user data", async ({ request }) => {
  await reset(request);
  const token = await enroll(request, "node-a");
  await enqueue(request, [VIDEO, "e2eresult02"]);
  const secret = "ZEBRA-PRIVATE-WORDS";
  const bodies: Record<string, unknown>[] = [];
  const keep = async (res: { status(): number; json(): Promise<unknown> }, status = 200): Promise<void> => {
    expect(res.status()).toBe(status);
    bodies.push((await res.json()) as Record<string, unknown>);
  };

  await keep(await request.post("/node/heartbeat", { headers: bearer(token), data: { version: "0.0.1", uptime_s: 1, jobs_in_progress: 0 } }));
  const jobs = await claim(request, token, 2);
  bodies.push({ jobs });
  const withText = { lease_id: jobs[0]!.lease_id, outcome: "ok", transcript: { ...JSON.parse(JSON.stringify({ video_id: jobs[0]!.video_id, status: "ok", lang: "en", source: "manual", word_count: 2, truncated: false, sponsor_ratio: null })), pages: [`${secret} words`] } };
  await keep(await request.post("/node/result", { headers: bearer(token), data: withText }));
  await keep(await request.post("/node/result", { headers: bearer(token), data: withText }));
  await keep(await request.post("/node/result", { headers: bearer(token), data: { ...withText, lease_id: "lease_unknown" } }), 409);
  await keep(await request.post("/node/release", { headers: bearer(token), data: { lease_id: jobs[1]!.lease_id } }));
  await keep(await request.post("/node/result", { headers: bearer(token), data: { lease_id: "x" } }), 400);

  const allowed = new Set(["node_id", "state", "hourly_budget", "directive", "jobs", "video_id", "lease_id", "lease_expires_at", "status", "error", "code", "message"]);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        expect(allowed.has(key), key).toBe(true);
        walk(inner);
      }
    }
  };
  bodies.forEach(walk);
  const text = JSON.stringify(bodies);
  expect(text).not.toContain(secret);
  expect(text).not.toMatch(/@/);
  expect(text).not.toContain(token);
});
