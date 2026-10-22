import type { NodeClaimResponse } from "./contracts/node-claim-response";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response";
import { sha256Hex } from "./hash";
import { errorResponse, json, notFound, type Env } from "./http";
import type { NodeJobAck } from "./contracts/node-job-ack";
import { failureStatus, endLease, pinLease, sweepExpired } from "./lease";
import { log } from "./log";
import { isClaimRequest, isHeartbeatRequest, isReleaseRequest, isResultRequest } from "./validate";
import type { TranscriptResult } from "./contracts/transcript-result";

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
  await sweepExpired(env);
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
  await sweepExpired(env);
  const seconds = leaseSeconds(env);
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();
  const [updated] = await env.DB.batch<Claimed>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'leased', leased_by = ?1,
         lease_id = 'lease_' || lower(hex(randomblob(16))), lease_expires_at = ?2,
         attempts = attempts + 1, tried_nodes = json_insert(tried_nodes, '$[#]', ?1)
       WHERE EXISTS (SELECT 1 FROM nodes WHERE node_id = ?1 AND revoked_at IS NULL)
         AND (video_id, kind) IN (
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

interface Lease {
  lease_id: string;
  video_id: string;
  node_id: string;
  state: string;
  response_json: string | null;
  attempts: number;
  expires_at: string;
}

const staleLease = (): Response => errorResponse(409, "stale_lease", "The lease is not the node's current lease");

// Section 8.4 step 2 and section 8.5: the lease must be the node's and active; a lease already in `replay` state
// answers again what it answered the first time.
async function checkLease(env: Env, node: Node, leaseId: string, replay: "completed" | "released"): Promise<Lease | Response> {
  const lease = await env.DB.prepare(
    `SELECT l.lease_id, l.video_id, l.node_id, l.state, l.response_json, l.expires_at, j.attempts FROM leases l
     LEFT JOIN jobs j ON j.video_id = l.video_id AND j.kind = 'primary' WHERE l.lease_id = ?`,
  )
    .bind(leaseId)
    .first<Lease>();
  if (lease !== null && lease.node_id === node.node_id) {
    if (lease.state === replay && lease.response_json !== null) {
      return new Response(lease.response_json, { headers: { "Content-Type": "application/json" } });
    }
    if (lease.state === "active" && lease.expires_at > new Date().toISOString()) {
      return lease;
    }
  }
  log("job.stale_result", {
    level: "warn",
    ...(lease === null ? {} : { video_id: lease.video_id }),
    attrs: { node_id: node.node_id },
  });
  return staleLease();
}

// Another request ended the lease between the check and the write: answer as the check now does.
async function lostRace(env: Env, node: Node, leaseId: string, replay: "completed" | "released"): Promise<Response> {
  const again = await checkLease(env, node, leaseId, replay);
  return again instanceof Response ? again : staleLease();
}

function wordCount(pages: string[]): number {
  return pages
    .filter((page) => page !== "[…]")
    .reduce((sum, page) => sum + page.split(/\s+/).filter((word) => word !== "").length, 0);
}

// Section 8.4 step 3; the reason is a short code, never transcript text.
function validationFailure(outcome: string, transcript: TranscriptResult | null, videoId: string): string | null {
  if (outcome !== "ok") {
    return transcript === null ? null : "transcript_not_null";
  }
  if (transcript === null) return "transcript_missing";
  if (transcript.status !== "ok") return "status_mismatch";
  if (transcript.video_id !== videoId) return "video_id_mismatch";
  if (transcript.pages.length === 0) return "pages_empty";
  if (transcript.word_count !== wordCount(transcript.pages)) return "word_count_mismatch";
  return null;
}

async function storeTranscript(env: Env, node: Node, lease: Lease, transcript: TranscriptResult): Promise<void> {
  const key = `transcripts/${lease.video_id}.json`;
  if ((await env.TRANSCRIPTS.head(key)) !== null) return;
  await env.TRANSCRIPTS.put(key, JSON.stringify(transcript), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { node_id: node.node_id, lease_id: lease.lease_id, produced_at: new Date().toISOString() },
    onlyIf: { etagDoesNotMatch: "*" },
  });
}

async function result(request: Request, env: Env, node: Node): Promise<Response> {
  const data = await body(request);
  if (!isResultRequest(data)) {
    return invalid();
  }
  await sweepExpired(env);
  const lease = await checkLease(env, node, data.lease_id, "completed");
  if (lease instanceof Response) {
    return lease;
  }
  const reason = validationFailure(data.outcome, data.transcript, lease.video_id);
  if (reason !== null) {
    const applied = await endLease(env, {
      leaseId: lease.lease_id,
      videoId: lease.video_id,
      nodeId: node.node_id,
      attempts: lease.attempts,
      leaseState: "rejected",
      nextStatus: failureStatus(lease.attempts),
      lastOutcome: "validation_failed",
      eventKind: "validation_failed",
      responseJson: null,
    });
    if (!applied) {
      return lostRace(env, node, data.lease_id, "completed");
    }
    log("job.validation_failed", { level: "warn", video_id: lease.video_id, attrs: { node_id: node.node_id, reason } });
    return errorResponse(422, "validation_failed", `Result rejected: ${reason}`);
  }
  if (data.outcome === "ok") {
    const pinned = await pinLease(env, lease.lease_id, new Date(Date.now() + leaseSeconds(env) * 1000).toISOString());
    if (!pinned) {
      return lostRace(env, node, data.lease_id, "completed");
    }
    try {
      await storeTranscript(env, node, lease, data.transcript!);
    } catch {
      return errorResponse(503, "storage_error", "The transcript could not be stored");
    }
  }
  const terminal = data.outcome === "ok" || data.outcome === "no_transcript";
  const status = terminal ? "done" : failureStatus(lease.attempts);
  const answer: NodeJobAck = { video_id: lease.video_id, status };
  const applied = await endLease(env, {
    leaseId: lease.lease_id,
    videoId: lease.video_id,
    nodeId: node.node_id,
    attempts: lease.attempts,
    leaseState: "completed",
    nextStatus: status,
    lastOutcome: data.outcome,
    eventKind: `job_${data.outcome}`,
    responseJson: JSON.stringify(answer),
  });
  if (!applied) {
    return lostRace(env, node, data.lease_id, "completed");
  }
  log("job.completed", { video_id: lease.video_id, attrs: { node_id: node.node_id, outcome: data.outcome, status } });
  return json(answer);
}

async function release(request: Request, env: Env, node: Node): Promise<Response> {
  const data = await body(request);
  if (!isReleaseRequest(data)) {
    return invalid();
  }
  await sweepExpired(env);
  const lease = await checkLease(env, node, data.lease_id, "released");
  if (lease instanceof Response) {
    return lease;
  }
  const answer: NodeJobAck = { video_id: lease.video_id, status: "queued" };
  const [, job] = await env.DB.batch([
    env.DB.prepare("UPDATE leases SET state = 'released', response_json = ?2 WHERE lease_id = ?1 AND state = 'active' AND expires_at > ?3").bind(
      lease.lease_id,
      JSON.stringify(answer),
      new Date().toISOString(),
    ),
    env.DB.prepare(
      `UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL,
         attempts = attempts - 1, last_outcome = 'released',
         tried_nodes = (SELECT json_group_array(value) FROM json_each(jobs.tried_nodes) WHERE value != ?3)
       WHERE video_id = ?1 AND kind = 'primary' AND status = 'leased' AND lease_id = ?2
         AND EXISTS (SELECT 1 FROM leases WHERE lease_id = ?2 AND state = 'released')
       RETURNING video_id`,
    ).bind(lease.video_id, lease.lease_id, node.node_id),
  ]);
  if (job!.results.length === 0) {
    return lostRace(env, node, data.lease_id, "released");
  }
  log("job.released", { video_id: lease.video_id, attrs: { node_id: node.node_id } });
  return json(answer);
}

export async function handleNode(request: Request, env: Env, path: string): Promise<Response> {
  const handler = request.method === "POST" ? { "/node/heartbeat": heartbeat, "/node/claim": claim, "/node/result": result, "/node/release": release }[path] : undefined;
  if (handler === undefined) {
    return notFound();
  }
  const node = await authenticate(request, env);
  return node instanceof Response ? node : handler(request, env, node);
}
