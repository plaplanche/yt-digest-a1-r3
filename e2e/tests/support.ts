import { expect, type APIRequestContext } from "@playwright/test";

export const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };

export interface Leased {
  video_id: string;
  lease_id: string;
  lease_expires_at: string;
}

export async function reset(request: APIRequestContext): Promise<void> {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
}

export async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

export async function enqueue(request: APIRequestContext, ids: string[]): Promise<void> {
  const res = await request.post("/ops/jobs", { headers: ops, data: { video_ids: ids } });
  expect(res.status()).toBe(200);
}

export const bearer = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

export async function claim(request: APIRequestContext, token: string, maxJobs = 6): Promise<Leased[]> {
  const res = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: maxJobs } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { jobs: Leased[] }).jobs;
}

export function transcript(videoId: string): Record<string, unknown> {
  return {
    video_id: videoId,
    status: "ok",
    lang: "en",
    source: "manual",
    word_count: 3,
    truncated: false,
    sponsor_ratio: null,
    pages: ["one two three"],
  };
}

export function result(request: APIRequestContext, token: string, leaseId: string, outcome: string, videoId?: string) {
  const data = { lease_id: leaseId, outcome, transcript: outcome === "ok" ? transcript(videoId!) : null };
  return request.post("/node/result", { headers: bearer(token), data });
}

export async function job(request: APIRequestContext, id: string): Promise<Record<string, unknown>> {
  const res = await request.get(`/ops/jobs/${id}`, { headers: ops });
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}
