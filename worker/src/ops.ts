import { sha256Hex } from "./hash";
import { errorResponse, json, notFound, type Env } from "./http";
import { revokeLeases, sweepExpired } from "./lease";
import { log } from "./log";
import { isEmailRequest, isEnqueueRequest, isEnrollRequest, VIDEO_ID } from "./validate";

// Every table of the schema (spec lot 2, section 6.3), emptied by POST /ops/reset.
const TABLES = [
  "nodes",
  "jobs",
  "leases",
  "node_events",
  "invites",
  "users",
  "oauth_clients",
  "oauth_requests",
  "oauth_codes",
  "oauth_tokens",
] as const;

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Compares the digests, so the time taken does not depend on where the strings differ or on their lengths.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) {
    diff |= da[i]! ^ db[i]!;
  }
  return diff === 0;
}

async function authenticated(request: Request, token: string): Promise<boolean> {
  const header = request.headers.get("Authorization");
  const match = header === null ? null : /^Bearer (.+)$/.exec(header);
  if (match === null) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: "missing" } });
    return false;
  }
  if (!(await safeEqual(match[1]!, token))) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: "unknown" } });
    return false;
  }
  return true;
}

async function reset(env: Env): Promise<Response> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const listed = await env.TRANSCRIPTS.list({ prefix: "transcripts/", cursor });
    if (listed.objects.length > 0) {
      await env.TRANSCRIPTS.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return json({ ok: true });
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const invalid = (): Response => errorResponse(400, "invalid_request", "Invalid request body");

function newNodeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ytd_node_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

async function enroll(request: Request, env: Env): Promise<Response> {
  const data = await jsonBody(request);
  if (!isEnrollRequest(data)) {
    return invalid();
  }
  const token = newNodeToken();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES (?, ?, ?, 'healthy', ?, ?)",
    )
      .bind(data.node_id, data.owner_label, await sha256Hex(token), now, now)
      .run();
  } catch (error) {
    const exists = await env.DB.prepare("SELECT 1 AS found FROM nodes WHERE node_id = ?").bind(data.node_id).first();
    if (exists === null) throw error;
    return errorResponse(409, "conflict", "Node already exists");
  }
  log("node.enrolled", { attrs: { node_id: data.node_id } });
  return json({ node_id: data.node_id, owner_label: data.owner_label, token });
}

async function enqueue(request: Request, env: Env): Promise<Response> {
  const data = await jsonBody(request);
  if (!isEnqueueRequest(data)) {
    return invalid();
  }
  const priority = data.priority ?? 0;
  const ids = [...new Set(data.video_ids)];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await env.DB.prepare(
      `SELECT video_id FROM jobs WHERE kind = 'primary' AND video_id IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<{ video_id: string }>();
    for (const row of rows.results) existing.add(row.video_id);
  }
  const now = new Date().toISOString();
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        `INSERT INTO jobs (video_id, kind, priority, status, created_at) VALUES (?1, 'primary', ?2, 'queued', ?3)
         ON CONFLICT (video_id, kind) DO UPDATE SET priority = max(priority, excluded.priority)`,
      ).bind(id, priority, now),
    ),
  );
  const seen = new Set<string>();
  const enqueued: string[] = [];
  const kept: string[] = [];
  for (const id of data.video_ids) {
    (existing.has(id) || seen.has(id) ? kept : enqueued).push(id);
    seen.add(id);
  }
  if (enqueued.length > 0) {
    log("job.enqueued", { attrs: { count: enqueued.length, priority } });
  }
  return json({ enqueued, existing: kept });
}

async function jobStatus(env: Env, videoId: string): Promise<Response> {
  await sweepExpired(env);
  const row = VIDEO_ID.test(videoId)
    ? await env.DB.prepare(
        `SELECT video_id, kind, priority, status, leased_by, lease_expires_at, attempts, tried_nodes,
           last_outcome, created_at, done_at FROM jobs WHERE video_id = ? AND kind = 'primary'`,
      )
        .bind(videoId)
        .first<{ tried_nodes: string }>()
    : null;
  if (row === null) {
    return notFound();
  }
  return json({ ...row, tried_nodes: JSON.parse(row.tried_nodes) as string[] });
}

async function revoke(env: Env, nodeId: string): Promise<Response> {
  const node = await env.DB.prepare("SELECT revoked_at FROM nodes WHERE node_id = ?").bind(nodeId).first<{ revoked_at: string | null }>();
  if (node === null) {
    return notFound();
  }
  const now = new Date().toISOString();
  const updated = await env.DB.prepare(
    "UPDATE nodes SET state = 'disabled', state_since = ?2, revoked_at = ?2 WHERE node_id = ?1 AND revoked_at IS NULL RETURNING node_id",
  )
    .bind(nodeId, now)
    .first();
  const revoked = await revokeLeases(env, nodeId);
  if (updated !== null) {
    log("node.revoked", { attrs: { node_id: nodeId, leases_revoked: revoked } });
  }
  return json({ node_id: nodeId, state: "disabled" });
}

async function transcript(env: Env, videoId: string): Promise<Response> {
  const object = VIDEO_ID.test(videoId) ? await env.TRANSCRIPTS.get(`transcripts/${videoId}.json`) : null;
  if (object === null) {
    return notFound();
  }
  const meta = object.customMetadata ?? {};
  return json({
    video_id: videoId,
    transcript: JSON.parse(await object.text()) as unknown,
    node_id: meta.node_id,
    lease_id: meta.lease_id,
    produced_at: meta.produced_at,
  });
}

async function invite(request: Request, env: Env): Promise<Response> {
  const data = await jsonBody(request);
  if (!isEmailRequest(data)) {
    return invalid();
  }
  const email = data.email.toLowerCase();
  await env.DB.prepare(
    "INSERT INTO invites (email, invited_at, revoked) VALUES (?, ?, 0) ON CONFLICT (email) DO UPDATE SET revoked = 0",
  )
    .bind(email, new Date().toISOString())
    .run();
  return json({ email, revoked: false });
}

async function revokeInvite(request: Request, env: Env): Promise<Response> {
  const data = await jsonBody(request);
  if (!isEmailRequest(data)) {
    return invalid();
  }
  const email = data.email.toLowerCase();
  const updated = await env.DB.prepare("UPDATE invites SET revoked = 1 WHERE email = ? RETURNING email").bind(email).first();
  if (updated === null) {
    return notFound();
  }
  return json({ email, revoked: true });
}

async function listUsers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare("SELECT user_sub, email, role FROM users ORDER BY email").all();
  return json({ users: rows.results });
}

export async function handleOps(request: Request, env: Env, path: string): Promise<Response> {
  const token = env.OPS_TOKEN;
  if (token === undefined || token === "") {
    return notFound();
  }
  if (!(await authenticated(request, token))) {
    return errorResponse(401, "unauthorized", "Missing or invalid operator token");
  }
  if (request.method === "POST" && path === "/ops/reset") {
    return reset(env);
  }
  if (request.method === "POST" && path === "/ops/nodes") {
    return enroll(request, env);
  }
  if (request.method === "POST" && path === "/ops/jobs") {
    return enqueue(request, env);
  }
  if (request.method === "POST" && path === "/ops/invites") {
    return invite(request, env);
  }
  if (request.method === "POST" && path === "/ops/invites/revoke") {
    return revokeInvite(request, env);
  }
  if (request.method === "GET" && path === "/ops/users") {
    return listUsers(env);
  }
  const job = request.method === "GET" ? /^\/ops\/jobs\/([^/]+)$/.exec(path) : null;
  if (job !== null) {
    return jobStatus(env, job[1]!);
  }
  const transcriptRoute = request.method === "GET" ? /^\/ops\/transcripts\/([^/]+)$/.exec(path) : null;
  if (transcriptRoute !== null) {
    return transcript(env, transcriptRoute[1]!);
  }
  const node = request.method === "DELETE" ? /^\/ops\/nodes\/([^/]+)$/.exec(path) : null;
  if (node !== null) {
    return revoke(env, node[1]!);
  }
  return notFound();
}
