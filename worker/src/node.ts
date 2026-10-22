import type { NodeClaimResponse } from "./contracts/node-claim-response";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response";
import { sha256Hex } from "./hash";
import { errorResponse, json, notFound, type Env } from "./http";
import { log } from "./log";
import { isClaimRequest, isHeartbeatRequest } from "./validate";

const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_MAX_JOBS = 3;

interface Node {
  node_id: string;
  hourly_budget: number;
}

export function leaseSeconds(env: Env): number {
  const value = Number.parseInt(env.LEASE_SECONDS ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LEASE_SECONDS;
}

function reject(reason: "missing" | "unknown" | "revoked"): Response {
  log("auth.bearer.rejected", { level: "warn", attrs: { surface: "node", reason } });
  return errorResponse(401, "unauthorized", "Missing or invalid node token");
}

async function authenticate(request: Request, env: Env): Promise<Node | Response> {
  const header = request.headers.get("Authorization");
  const match = header === null ? null : /^Bearer (.+)$/.exec(header);
  if (match === null) {
    return reject("missing");
  }
  const row = await env.DB.prepare("SELECT node_id, hourly_budget, revoked_at FROM nodes WHERE token_hash = ?")
    .bind(await sha256Hex(match[1]!))
    .first<Node & { revoked_at: string | null }>();
  if (row === null) {
    return reject("unknown");
  }
  return row.revoked_at === null ? row : reject("revoked");
}

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const invalid = (): Response => errorResponse(400, "invalid_request", "Invalid request body");

async function heartbeat(request: Request, env: Env, node: Node): Promise<Response> {
  const data = await body(request);
  if (!isHeartbeatRequest(data)) {
    return invalid();
  }
  await env.DB.prepare("UPDATE nodes SET last_heartbeat_at = ?, version = ? WHERE node_id = ?")
    .bind(new Date().toISOString(), data.version, node.node_id)
    .run();
  log("node.heartbeat", {
    attrs: { node_id: node.node_id, version: data.version, jobs_in_progress: data.jobs_in_progress },
  });
  const answer: NodeHeartbeatResponse = {
    node_id: node.node_id,
    state: "healthy",
    hourly_budget: node.hourly_budget,
    directive: "run",
  };
  return json(answer);
}

interface Claimed {
  video_id: string;
  lease_id: string;
  lease_expires_at: string;
  priority: number;
  created_at: string;
  attempts: number;
}

// One UPDATE picks and leases the jobs, so concurrent claims cannot take the same one nor come back short;
// the leases rows are inserted in the same batch (one transaction) from the jobs just leased.
async function claim(request: Request, env: Env, node: Node): Promise<Response> {
  const data = await body(request);
  if (!isClaimRequest(data)) {
    return invalid();
  }
  const seconds = leaseSeconds(env);
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();
  const [updated] = await env.DB.batch<Claimed>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'leased', leased_by = ?1,
         lease_id = 'lease_' || lower(hex(randomblob(16))), lease_expires_at = ?2,
         attempts = attempts + 1, tried_nodes = json_insert(tried_nodes, '$[#]', ?1)
       WHERE (video_id, kind) IN (
         SELECT video_id, kind FROM jobs
         WHERE status = 'queued' AND NOT EXISTS (SELECT 1 FROM json_each(jobs.tried_nodes) WHERE value = ?1)
         ORDER BY priority DESC, created_at ASC, video_id ASC LIMIT ?3)
       RETURNING video_id, lease_id, lease_expires_at, priority, created_at, attempts`,
    ).bind(node.node_id, expiresAt, data.max_jobs ?? DEFAULT_MAX_JOBS),
    env.DB.prepare(
      `INSERT OR IGNORE INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state)
       SELECT lease_id, video_id, leased_by, ?3, lease_expires_at, 'active' FROM jobs
       WHERE status = 'leased' AND leased_by = ?1 AND lease_expires_at = ?2`,
    ).bind(node.node_id, expiresAt, issuedAt),
  ]);
  const claimed = updated!.results.sort(
    (a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.video_id.localeCompare(b.video_id),
  );
  for (const job of claimed) {
    log("job.claimed", {
      video_id: job.video_id,
      attrs: { node_id: node.node_id, attempt: job.attempts, lease_seconds: seconds },
    });
  }
  const answer: NodeClaimResponse = {
    jobs: claimed.map((job) => ({
      video_id: job.video_id,
      lease_id: job.lease_id,
      lease_expires_at: job.lease_expires_at,
    })),
  };
  return json(answer);
}

export async function handleNode(request: Request, env: Env, path: string): Promise<Response> {
  const handler = request.method === "POST" ? { "/node/heartbeat": heartbeat, "/node/claim": claim }[path] : undefined;
  if (handler === undefined) {
    return notFound();
  }
  const node = await authenticate(request, env);
  return node instanceof Response ? node : handler(request, env, node);
}
