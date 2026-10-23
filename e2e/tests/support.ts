import { createHash } from "node:crypto";
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

export interface McpSession {
  base: string;
  accessToken: string;
}

// Runs the whole OAuth dance of an invited user through the API only, without a browser.
export async function mcpLogin(request: APIRequestContext, email: string): Promise<McpSession> {
  const redirectUri = "http://127.0.0.1:9/cb";
  await request.post("/ops/invites", { headers: ops, data: { email } });
  const registered = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  const base = new URL(registered.url()).origin;
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const verifier = "e2e-verifier-e2e-verifier-e2e-verifier-0123456789";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
    state: "st",
  });
  const page = await request.get(`/authorize?${query}`);
  const requestId = /name="request" value="([^"]+)"/.exec(await page.text())![1]!;
  const approve = await request.post("/authorize/consent", { form: { request: requestId, decision: "approve" }, maxRedirects: 0 });
  const googleUrl = new URL(approve.headers().location!);
  googleUrl.searchParams.set("login_hint", email);
  const back = await request.get(googleUrl.toString(), { maxRedirects: 0 });
  const done = await request.get(back.headers().location!, { maxRedirects: 0 });
  const code = new URL(done.headers().location!).searchParams.get("code")!;
  const issued = await request.post("/token", {
    form: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier, resource: `${base}/mcp` },
  });
  expect(issued.status()).toBe(200);
  return { base, accessToken: ((await issued.json()) as { access_token: string }).access_token };
}

export function mcp(request: APIRequestContext, token: string | null, message: unknown) {
  return request.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream", ...(token === null ? {} : bearer(token)) },
    data: message,
  });
}
