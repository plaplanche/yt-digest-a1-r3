import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(request: APIRequestContext, token: string): Promise<string[]> {
  const res = await request.post("/node/claim", { headers: { Authorization: `Bearer ${token}` }, data: { max_jobs: 6 } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { jobs: { video_id: string }[] }).jobs.map((job) => job.video_id);
}

test("2 nodes claim 6 jobs concurrently and each job is handed out once", async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
  const ids = Array.from({ length: 6 }, (_, i) => `e2eclaim${String(i).padStart(3, "0")}`);
  const tokens = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  const queued = await request.post("/ops/jobs", { headers: ops, data: { video_ids: ids } });
  expect(await queued.json()).toEqual({ enqueued: ids, existing: [] });

  const claimed = await Promise.all(tokens.map((token) => claim(request, token)));
  const all = claimed.flat();
  expect(all).toHaveLength(6);
  expect([...all].sort()).toEqual(ids);

  for (const [i, id] of ids.entries()) {
    const res = await request.get(`/ops/jobs/${id}`, { headers: ops });
    const job = (await res.json()) as { status: string; attempts: number; tried_nodes: string[] };
    expect(job.status).toBe("leased");
    expect(job.attempts).toBe(1);
    expect(job.tried_nodes, String(i)).toHaveLength(1);
  }
});
