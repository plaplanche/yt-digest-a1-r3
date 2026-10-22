import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
  const response = await post("/ops/nodes", { node_id: nodeId, owner_label: nodeId }, env.OPS_TOKEN);
  return (await response.json<{ token: string }>()).token;
}

async function enqueue(...ids: string[]): Promise<void> {
  expect((await post("/ops/jobs", { video_ids: ids }, env.OPS_TOKEN)).status).toBe(200);
}

async function claimOne(token: string): Promise<{ video_id: string; lease_id: string; lease_expires_at: string }> {
  const response = await post("/node/claim", { max_jobs: 1 }, token);
  const { jobs } = await response.json<{ jobs: { video_id: string; lease_id: string; lease_expires_at: string }[] }>();
  expect(jobs).toHaveLength(1);
  return jobs[0]!;
}

async function job(videoId: string): Promise<Record<string, unknown>> {
  return (await call(`/ops/jobs/${videoId}`, { headers: OPS })).json();
}

const VIDEO = "video000001";

function transcript(videoId = VIDEO, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    video_id: videoId,
    status: "ok",
    lang: "en",
    source: "manual",
    word_count: 5,
    truncated: false,
    sponsor_ratio: null,
    pages: ["hello brave new", "world\n  again", "[…]"],
    ...overrides,
  };
}

const ok = (leaseId: string, t: Record<string, unknown> | null = transcript()) => ({ lease_id: leaseId, outcome: "ok", transcript: t });
const failed = (leaseId: string, outcome: string) => ({ lease_id: leaseId, outcome, transcript: null });

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect((await response.json<{ error: { code: string } }>()).error.code).toBe(code);
}

async function count(table: string, where = "1"): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;
}

async function stored(): Promise<number> {
  return (await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects.length;
}

async function leaseState(leaseId: string): Promise<string> {
  return (await env.DB.prepare("SELECT state FROM leases WHERE lease_id = ?").bind(leaseId).first<{ state: string }>())!.state;
}

async function expire(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE status = 'leased'"),
    env.DB.prepare("UPDATE leases SET expires_at = '2000-01-01T00:00:00.000Z' WHERE state = 'active'"),
  ]);
}

beforeEach(async () => {
  await call("/ops/reset", { method: "POST", headers: OPS });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /node/result, outcome ok", () => {
  test("stores the transcript in R2 with its metadata and makes the job done", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    const response = await post("/node/result", ok(lease.lease_id), token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ video_id: VIDEO, status: "done" });
    expect(await job(VIDEO)).toMatchObject({ status: "done", last_outcome: "ok", leased_by: null, lease_expires_at: null });
    expect((await job(VIDEO)).done_at).toMatch(/Z$/);
    const object = await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`);
    expect(object?.httpMetadata?.contentType).toBe("application/json");
    expect(object?.customMetadata).toMatchObject({ node_id: "pi-1", lease_id: lease.lease_id });
    expect(object?.customMetadata?.produced_at).toMatch(/Z$/);
    expect(await object?.text()).toBe(JSON.stringify(transcript()));
    expect(await leaseState(lease.lease_id)).toBe("completed");
    expect(await count("node_events", "kind = 'job_ok'")).toBe(1);

    const read = await call(`/ops/transcripts/${VIDEO}`, { headers: OPS });
    expect(await read.json()).toEqual({
      video_id: VIDEO,
      transcript: transcript(),
      node_id: "pi-1",
      lease_id: lease.lease_id,
      produced_at: object?.customMetadata?.produced_at,
    });
  });

  test("the same result sent again gives the same 200 and writes nothing", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    const first = await post("/node/result", ok(lease.lease_id), token);
    const put = vi.spyOn(env.TRANSCRIPTS, "put");
    const again = await post("/node/result", ok(lease.lease_id, transcript(VIDEO, { lang: "fr" })), token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(put).not.toHaveBeenCalled();
    expect(await stored()).toBe(1);
    expect(await count("node_events")).toBe(1);
    expect((await post("/node/result", failed(lease.lease_id, "error"), token)).status).toBe(200);
    expect(await job(VIDEO)).toMatchObject({ status: "done", last_outcome: "ok", attempts: 1 });
  });

  test("two concurrent copies of the same result write once", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    const responses = await Promise.all([1, 2, 3].map(() => post("/node/result", ok(lease.lease_id), token)));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ video_id: VIDEO, status: "done" });
    }
    expect(await count("node_events")).toBe(1);
    expect(await stored()).toBe(1);
  });

  test("an existing R2 object is never overwritten", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    await env.TRANSCRIPTS.put(`transcripts/${VIDEO}.json`, "old");
    const lease = await claimOne(token);
    expect((await post("/node/result", ok(lease.lease_id), token)).status).toBe(200);
    expect(await (await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`))?.text()).toBe("old");
    expect(await job(VIDEO)).toMatchObject({ status: "done" });
  });

  test("an R2 failure is 503 and leaves the lease active", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    vi.spyOn(env.TRANSCRIPTS, "put").mockRejectedValue(new Error("boom"));
    await expectError(await post("/node/result", ok(lease.lease_id), token), 503, "storage_error");
    expect(await leaseState(lease.lease_id)).toBe("active");
    expect(await job(VIDEO)).toMatchObject({ status: "leased", last_outcome: null });
    vi.restoreAllMocks();
    expect((await post("/node/result", ok(lease.lease_id), token)).status).toBe(200);
  });
});

describe("POST /node/result, other outcomes", () => {
  test("no_transcript is terminal and writes nothing to R2", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    const response = await post("/node/result", failed(lease.lease_id, "no_transcript"), token);
    expect(await response.json()).toEqual({ video_id: VIDEO, status: "done" });
    expect(await job(VIDEO)).toMatchObject({ status: "done", last_outcome: "no_transcript" });
    expect(await stored()).toBe(0);
    expect(await count("node_events", "kind = 'job_no_transcript'")).toBe(1);
  });

  test.each(["unavailable", "blocked", "error"])("%s requeues for another node and the third failure is failed_video", async (outcome) => {
    const tokens = await Promise.all(["a", "b", "c", "d"].map((n) => enroll(`node-${n}`)));
    await enqueue(VIDEO);
    for (const [i, token] of tokens.slice(0, 3).entries()) {
      const lease = await claimOne(token);
      const response = await post("/node/result", failed(lease.lease_id, outcome), token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ video_id: VIDEO, status: i < 2 ? "queued" : "failed_video" });
      expect(await job(VIDEO)).toMatchObject({ attempts: i + 1, last_outcome: outcome, leased_by: null, lease_expires_at: null });
      expect(await count("node_events", `kind = 'job_${outcome}'`)).toBe(i + 1);
      // The node that failed is not offered the job again.
      expect((await (await post("/node/claim", {}, token)).json<{ jobs: unknown[] }>()).jobs).toEqual([]);
    }
    expect(await job(VIDEO)).toMatchObject({ status: "failed_video", tried_nodes: ["node-a", "node-b", "node-c"] });
    expect((await job(VIDEO)).done_at).toMatch(/Z$/);
    expect((await (await post("/node/claim", {}, tokens[3]!)).json<{ jobs: unknown[] }>()).jobs).toEqual([]);
  });
});

describe("POST /node/result, lease check", () => {
  test("an unknown lease, another node's lease and a bad body", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    const lease = await claimOne(one);
    await expectError(await post("/node/result", ok("lease_unknown"), one), 409, "stale_lease");
    await expectError(await post("/node/result", ok(lease.lease_id), two), 409, "stale_lease");
    for (const bad of [{}, { lease_id: "", outcome: "ok", transcript: null }, { lease_id: "x", outcome: "nope", transcript: null }, { lease_id: "x", outcome: "error" }, { lease_id: "x", outcome: "ok", transcript: { video_id: VIDEO } }]) {
      await expectError(await post("/node/result", bad, one), 400, "invalid_request");
    }
    expect(await stored()).toBe(0);
    expect(await job(VIDEO)).toMatchObject({ status: "leased" });
  });

  test("an expired lease requeues the job and the late result is 409 and writes nothing", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    const lease = await claimOne(one);
    await expire();
    await expectError(await post("/node/result", ok(lease.lease_id), one), 409, "stale_lease");
    expect(await stored()).toBe(0);
    expect(await leaseState(lease.lease_id)).toBe("expired");
    expect(await job(VIDEO)).toMatchObject({ status: "queued", last_outcome: "lease_expired", attempts: 1, tried_nodes: ["pi-1"] });
    expect(await count("node_events", "kind = 'lease_expired' AND node_id = 'pi-1'")).toBe(1);
    const second = await claimOne(two);
    expect(second.lease_id).not.toBe(lease.lease_id);
    expect((await post("/node/result", ok(second.lease_id), two)).status).toBe(200);
  });

  test("a lease expiring exactly at lease_expires_at is expired, one millisecond before it is not", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    expect(lease.lease_expires_at).toBe("2026-10-22T10:10:00.000Z");
    vi.setSystemTime(new Date("2026-10-22T10:09:59.999Z"));
    expect(await job(VIDEO)).toMatchObject({ status: "leased" });
    vi.setSystemTime(new Date("2026-10-22T10:10:00.000Z"));
    expect(await job(VIDEO)).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
    await expectError(await post("/node/result", ok(lease.lease_id), token), 409, "stale_lease");
  });

  test("a lease past its expiry that the sweep has not seen yet is refused", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    await env.DB.prepare("UPDATE leases SET expires_at = '2000-01-01T00:00:00.000Z' WHERE lease_id = ?").bind(lease.lease_id).run();
    await expectError(await post("/node/result", ok(lease.lease_id), token), 409, "stale_lease");
    expect(await stored()).toBe(0);
  });

  test("a sweep running during the R2 write cannot expire the lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    const lease = await claimOne(one);
    vi.setSystemTime(new Date("2026-10-22T10:09:59.900Z"));
    const put = env.TRANSCRIPTS.put.bind(env.TRANSCRIPTS);
    const spy = vi.spyOn(env.TRANSCRIPTS, "put").mockImplementation(async (...args: Parameters<typeof put>) => {
      vi.setSystemTime(new Date("2026-10-22T10:10:01.000Z"));
      await post("/node/heartbeat", { version: "v", uptime_s: 0, jobs_in_progress: 0 }, two);
      return put(...args);
    });
    const response = await post("/node/result", ok(lease.lease_id), one);
    spy.mockRestore();
    expect(response.status).toBe(200);
    expect(await leaseState(lease.lease_id)).toBe("completed");
    expect(await job(VIDEO)).toMatchObject({ status: "done" });
  });

  test("a revocation during the R2 write leaves no object and answers 409", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    const lease = await claimOne(one);
    const put = env.TRANSCRIPTS.put.bind(env.TRANSCRIPTS);
    const spy = vi.spyOn(env.TRANSCRIPTS, "put").mockImplementation(async (...args: Parameters<typeof put>) => {
      await call("/ops/nodes/pi-1", { method: "DELETE", headers: OPS });
      return put(...args);
    });
    const response = await post("/node/result", ok(lease.lease_id), one);
    spy.mockRestore();
    expect(response.status).toBe(409);
    expect(await stored()).toBe(0);
    expect(await leaseState(lease.lease_id)).toBe("revoked");
    const next = await claimOne(two);
    expect((await post("/node/result", ok(next.lease_id), two)).status).toBe(200);
    expect(await stored()).toBe(1);
  });

  test("the third expiry gives failed_video", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
    const tokens = await Promise.all(["a", "b", "c"].map((n) => enroll(`node-${n}`)));
    await enqueue(VIDEO);
    for (const [i, token] of tokens.entries()) {
      await claimOne(token);
      vi.setSystemTime(new Date(Date.parse("2026-10-22T10:00:00.000Z") + (i + 1) * 601_000));
      expect(await job(VIDEO)).toMatchObject({ status: i < 2 ? "queued" : "failed_video", attempts: i + 1 });
    }
  });

  test("every /node/* request sweeps", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    await claimOne(one);
    await expire();
    await post("/node/heartbeat", { version: "v", uptime_s: 0, jobs_in_progress: 0 }, two);
    expect(await count("jobs", "status = 'queued'")).toBe(1);
  });
});

describe("POST /node/result, validation", () => {
  const cases: [string, (leaseId: string) => unknown][] = [
    ["ok with a null transcript", (l) => ok(l, null)],
    ["ok with a transcript whose status is not ok", (l) => ok(l, transcript(VIDEO, { status: "blocked" }))],
    ["a transcript of another video", (l) => ok(l, transcript("video000002"))],
    ["no pages", (l) => ok(l, transcript(VIDEO, { pages: [], word_count: 0 }))],
    ["a wrong word_count", (l) => ok(l, transcript(VIDEO, { word_count: 6 }))],
    ["no_transcript with a transcript", (l) => ({ lease_id: l, outcome: "no_transcript", transcript: transcript() })],
    ["error with a transcript", (l) => ({ lease_id: l, outcome: "error", transcript: transcript() })],
  ];

  test.each(cases)("%s is 422, rejects the lease and counts as a failure", async (_name, build) => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    await expectError(await post("/node/result", build(lease.lease_id), token), 422, "validation_failed");
    expect(await stored()).toBe(0);
    expect(await leaseState(lease.lease_id)).toBe("rejected");
    expect(await job(VIDEO)).toMatchObject({ status: "queued", last_outcome: "validation_failed", attempts: 1, leased_by: null });
    expect(await count("node_events", "kind = 'validation_failed'")).toBe(1);
    await expectError(await post("/node/result", ok(lease.lease_id), token), 409, "stale_lease");
  });

  test("the third validation failure gives failed_video", async () => {
    const tokens = await Promise.all(["a", "b", "c"].map((n) => enroll(`node-${n}`)));
    await enqueue(VIDEO);
    for (const token of tokens) {
      const lease = await claimOne(token);
      await expectError(await post("/node/result", ok(lease.lease_id, null), token), 422, "validation_failed");
    }
    expect(await job(VIDEO)).toMatchObject({ status: "failed_video", attempts: 3 });
  });

  test("a page […] alone and whitespace-separated tokens are counted as specified", async () => {
    const token = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(token);
    const t = transcript(VIDEO, { pages: ["[…]", " a\tb \n c "], word_count: 3 });
    expect((await post("/node/result", ok(lease.lease_id, t), token)).status).toBe(200);
  });
});

describe("POST /node/release", () => {
  test("undoes the claim and is idempotent", async () => {
    const one = await enroll("pi-1");
    await enqueue(VIDEO);
    const lease = await claimOne(one);
    const response = await post("/node/release", { lease_id: lease.lease_id }, one);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ video_id: VIDEO, status: "queued" });
    expect(await job(VIDEO)).toMatchObject({
      status: "queued", leased_by: null, lease_expires_at: null, attempts: 0, tried_nodes: [], last_outcome: "released",
    });
    expect(await leaseState(lease.lease_id)).toBe("released");
    const again = await post("/node/release", { lease_id: lease.lease_id }, one);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ video_id: VIDEO, status: "queued" });
    expect(await job(VIDEO)).toMatchObject({ attempts: 0 });
    // The same node can claim it again.
    expect((await claimOne(one)).video_id).toBe(VIDEO);
    await expectError(await post("/node/result", ok(lease.lease_id), one), 409, "stale_lease");
  });

  test("keeps the other nodes in tried_nodes", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO);
    const first = await claimOne(one);
    await post("/node/result", failed(first.lease_id, "error"), one);
    const second = await claimOne(two);
    await post("/node/release", { lease_id: second.lease_id }, two);
    expect(await job(VIDEO)).toMatchObject({ attempts: 1, tried_nodes: ["pi-1"], status: "queued" });
  });

  test("stale cases are 409: unknown, other node, completed, expired, and a bad body is 400", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO, "video000002");
    const [a, b] = [await claimOne(one), await claimOne(one)];
    await expectError(await post("/node/release", { lease_id: "lease_nope" }, one), 409, "stale_lease");
    await expectError(await post("/node/release", { lease_id: a.lease_id }, two), 409, "stale_lease");
    await post("/node/result", failed(a.lease_id, "no_transcript"), one);
    await expectError(await post("/node/release", { lease_id: a.lease_id }, one), 409, "stale_lease");
    await expire();
    await expectError(await post("/node/release", { lease_id: b.lease_id }, one), 409, "stale_lease");
    expect(await leaseState(b.lease_id)).toBe("expired");
    for (const bad of [{}, { lease_id: "" }, { lease_id: "x", more: 1 }]) {
      await expectError(await post("/node/release", bad, one), 400, "invalid_request");
    }
  });
});

describe("DELETE /ops/nodes/<node_id>", () => {
  const revoke = (id: string): Promise<Response> => call(`/ops/nodes/${id}`, { method: "DELETE", headers: OPS });

  test("disables the node, refuses its token and reassigns its jobs", async () => {
    const one = await enroll("pi-1");
    const two = await enroll("pi-2");
    await enqueue(VIDEO, "video000002");
    const lease = await claimOne(one);
    const response = await revoke("pi-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ node_id: "pi-1", state: "disabled" });
    expect(await count("nodes", "node_id = 'pi-1' AND state = 'disabled' AND revoked_at IS NOT NULL")).toBe(1);
    expect(await leaseState(lease.lease_id)).toBe("revoked");
    expect(await job(lease.video_id)).toMatchObject({ status: "queued", last_outcome: "lease_revoked", leased_by: null, attempts: 1 });
    await expectError(await post("/node/claim", {}, one), 401, "unauthorized");
    await expectError(await post("/node/result", ok(lease.lease_id), one), 401, "unauthorized");
    const reassigned = await post("/node/claim", {}, two);
    expect((await reassigned.json<{ jobs: { video_id: string }[] }>()).jobs.map((j) => j.video_id).sort()).toEqual([VIDEO, "video000002"]);
    expect(await stored()).toBe(0);
  });

  test("a claim racing the revocation leaves no active lease", async () => {
    const one = await enroll("pi-1");
    await enqueue(VIDEO);
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (...args: Parameters<typeof batch>) => {
      await revoke("pi-1");
      return batch(...args);
    });
    const response = await post("/node/claim", {}, one);
    spy.mockRestore();
    expect((await response.json<{ jobs: unknown[] }>()).jobs).toEqual([]);
    expect(await count("leases", "state = 'active'")).toBe(0);
    expect(await job(VIDEO)).toMatchObject({ status: "queued", attempts: 0 });
  });

  test("is idempotent, 404 for an unknown node, and the third revocation gives failed_video", async () => {
    await enroll("pi-1");
    expect((await revoke("pi-1")).status).toBe(200);
    expect(await (await revoke("pi-1")).json()).toEqual({ node_id: "pi-1", state: "disabled" });
    await expectError(await revoke("ghost"), 404, "not_found");
    await expectError(await call("/ops/nodes/pi-1", { method: "DELETE" }), 401, "unauthorized");
    await expectError(await post("/ops/nodes", { node_id: "pi-1", owner_label: "x" }, env.OPS_TOKEN), 409, "conflict");

    await enqueue(VIDEO);
    for (const n of ["a", "b", "c"]) {
      const token = await enroll(`node-${n}`);
      await claimOne(token);
      await revoke(`node-${n}`);
    }
    expect(await job(VIDEO)).toMatchObject({ status: "failed_video", last_outcome: "lease_revoked", attempts: 3 });
  });
});

describe("GET /ops/transcripts/<video_id>", () => {
  test("404 without an object, 401 without the operator token", async () => {
    await expectError(await call(`/ops/transcripts/${VIDEO}`, { headers: OPS }), 404, "not_found");
    await expectError(await call("/ops/transcripts/bad", { headers: OPS }), 404, "not_found");
    await expectError(await call(`/ops/transcripts/${VIDEO}`), 401, "unauthorized");
  });
});

describe("log events", () => {
  test("job.completed, job.released, job.lease_expired, job.stale_result, job.validation_failed and node.revoked", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    });
    const one = await enroll("pi-1");
    await enqueue(VIDEO, "video000002", "video000003");
    const [a, b, c] = [await claimOne(one), await claimOne(one), await claimOne(one)];
    await post("/node/result", ok(a.lease_id), one);
    await post("/node/result", ok("lease_unknown"), one);
    await post("/node/release", { lease_id: a.lease_id }, one);
    await post("/node/release", { lease_id: b.lease_id }, one);
    await post("/node/result", ok(c.lease_id, null), one);
    await enqueue("video000004");
    await claimOne(one);
    await expire();
    await call("/ops/jobs/video000004", { headers: OPS });
    await enqueue("video000005");
    const two = await enroll("pi-2");
    await claimOne(two);
    await call("/ops/nodes/pi-2", { method: "DELETE", headers: OPS });
    const by = (event: string): Record<string, unknown>[] => lines.filter((l) => l.event === event);
    expect(by("job.completed")).toMatchObject([{ video_id: VIDEO, attrs: { node_id: "pi-1", outcome: "ok", status: "done" } }]);
    expect(by("job.released")).toMatchObject([{ video_id: "video000002", attrs: { node_id: "pi-1" } }]);
    expect(by("job.stale_result")).toMatchObject([{ attrs: { node_id: "pi-1" } }, { video_id: VIDEO, attrs: { node_id: "pi-1" } }]);
    expect(by("job.validation_failed")).toMatchObject([{ video_id: "video000003", attrs: { node_id: "pi-1", reason: "transcript_missing" } }]);
    expect(by("job.lease_expired")).toMatchObject([{ video_id: "video000002", attrs: { node_id: "pi-1", attempts: 1, status: "queued" } }]);
    expect(by("node.revoked")).toMatchObject([{ attrs: { node_id: "pi-2", leases_revoked: 1 } }]);
  });
});
