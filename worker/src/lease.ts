import { log } from "./log";

export const MAX_ATTEMPTS = 3;

export type JobStatus = "queued" | "done" | "failed_video";

// Where a failed attempt leads (spec lot 2, section 8.7).
export function failureStatus(attempts: number): JobStatus {
  return attempts >= MAX_ATTEMPTS ? "failed_video" : "queued";
}

export interface LeaseEnd {
  leaseId: string;
  videoId: string;
  nodeId: string;
  attempts: number;
  leaseState: "completed" | "expired" | "revoked" | "rejected";
  nextStatus: JobStatus;
  lastOutcome: string;
  eventKind: string | null;
  responseJson: string | null;
}

// Ends an active lease and moves its job in one batch. Both writes are conditional on the lease still being the
// job's current one, so only one of several concurrent requests applies; the others get false.
export async function endLease(env: { DB: D1Database }, end: LeaseEnd): Promise<boolean> {
  const now = new Date().toISOString();
  const finished = end.nextStatus === "queued" ? null : now;
  const statements = [
    env.DB.prepare(
      `UPDATE leases SET state = ?2, response_json = ?3 WHERE lease_id = ?1 AND state = 'active'
         AND (?2 != 'expired' OR expires_at <= ?4)`,
    ).bind(end.leaseId, end.leaseState, end.responseJson, now),
    env.DB.prepare(
      `UPDATE jobs SET status = ?3, done_at = ?4, last_outcome = ?5,
         leased_by = NULL, lease_id = NULL, lease_expires_at = NULL
       WHERE video_id = ?1 AND kind = 'primary' AND status = 'leased' AND lease_id = ?2 AND attempts = ?6
         AND EXISTS (SELECT 1 FROM leases WHERE lease_id = ?2 AND state = ?7)
       RETURNING video_id`,
    ).bind(end.videoId, end.leaseId, end.nextStatus, finished, end.lastOutcome, end.attempts, end.leaseState),
  ];
  if (end.eventKind !== null) {
    statements.push(
      env.DB.prepare("INSERT INTO node_events (node_id, ts, kind, video_id) SELECT ?, ?, ?, ? WHERE changes() > 0").bind(
        end.nodeId,
        now,
        end.eventKind,
        end.videoId,
      ),
    );
  }
  const results = await env.DB.batch(statements);
  return results[1]!.results.length > 0;
}

interface Held {
  video_id: string;
  lease_id: string;
  leased_by: string;
  attempts: number;
}

// Lease expiry (section 8.6): every leased job whose lease is at or before now fails over to another node.
export async function sweepExpired(env: { DB: D1Database }): Promise<void> {
  const expired = await env.DB.prepare(
    `SELECT video_id, lease_id, leased_by, attempts FROM jobs
     WHERE status = 'leased' AND lease_expires_at <= ?`,
  )
    .bind(new Date().toISOString())
    .all<Held>();
  for (const job of expired.results) {
    const nextStatus = failureStatus(job.attempts);
    const applied = await endLease(env, {
      leaseId: job.lease_id,
      videoId: job.video_id,
      nodeId: job.leased_by,
      attempts: job.attempts,
      leaseState: "expired",
      nextStatus,
      lastOutcome: "lease_expired",
      eventKind: "lease_expired",
      responseJson: null,
    });
    if (applied) {
      log("job.lease_expired", {
        video_id: job.video_id,
        attrs: { node_id: job.leased_by, attempts: job.attempts, status: nextStatus },
      });
    }
  }
}

// Node revocation (section 8.8): each active lease of the node is revoked and its job fails over.
export async function revokeLeases(env: { DB: D1Database }, nodeId: string): Promise<number> {
  const held = await env.DB.prepare(
    `SELECT l.lease_id, l.video_id, j.attempts FROM leases l
     JOIN jobs j ON j.video_id = l.video_id AND j.kind = 'primary' AND j.lease_id = l.lease_id AND j.status = 'leased'
     WHERE l.node_id = ? AND l.state = 'active'`,
  )
    .bind(nodeId)
    .all<{ lease_id: string; video_id: string; attempts: number }>();
  let revoked = 0;
  for (const lease of held.results) {
    const applied = await endLease(env, {
      leaseId: lease.lease_id,
      videoId: lease.video_id,
      nodeId,
      attempts: lease.attempts,
      leaseState: "revoked",
      nextStatus: failureStatus(lease.attempts),
      lastOutcome: "lease_revoked",
      eventKind: null,
      responseJson: null,
    });
    if (applied) revoked++;
  }
  return revoked;
}
