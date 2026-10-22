import { expect, test } from "@playwright/test";
import { claim, enqueue, enroll, job, ops, reset, result } from "./support";

test("E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done", async ({ request }) => {
  await reset(request);
  const ids = Array.from({ length: 6 }, (_, i) => `e2eclaim${String(i).padStart(3, "0")}`);
  const tokens = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  await enqueue(request, ids);

  const claimed = await Promise.all(tokens.map((token) => claim(request, token, 3)));
  const all = claimed.flat();
  expect(all).toHaveLength(6);
  expect(all.map((j) => j.video_id).sort()).toEqual(ids);

  for (const [i, id] of ids.entries()) {
    const found = await job(request, id);
    expect(found.status).toBe("leased");
    expect(found.attempts).toBe(1);
    expect(found.tried_nodes as string[], String(i)).toHaveLength(1);
  }

  await Promise.all(
    claimed.flatMap((jobs, i) =>
      jobs.map(async (leased) => {
        const res = await result(request, tokens[i]!, leased.lease_id, "ok", leased.video_id);
        expect(res.status()).toBe(200);
        expect(await res.json()).toEqual({ video_id: leased.video_id, status: "done" });
      }),
    ),
  );
  for (const id of ids) {
    expect(await job(request, id)).toMatchObject({ status: "done", last_outcome: "ok", attempts: 1 });
    const stored = await request.get(`/ops/transcripts/${id}`, { headers: ops });
    expect(stored.status()).toBe(200);
  }
});
