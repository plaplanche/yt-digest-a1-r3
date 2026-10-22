# Review 2

- Reviewed commit: `93eee34c72a260d0d1313f3a29b01686a6abcbe0`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/node.ts:217`) discardTranscript can delete the transcript a later lease's `done` job depends on (data loss)

  This breaks one of the three properties that keep a finding blocking: it loses data. The 1.1 fix for round 1 cleans up after the write instead of preventing a stale write. Here is the order of writes in the A path (node A, lease L1, outcome ok): checkLease, pinLease (D1), TRANSCRIPTS.head, TRANSCRIPTS.put with metadata lease_id=L1, endLease batch (fails), SELECT lease state, TRANSCRIPTS.head, TRANSCRIPTS.delete. Interleaving: (1) A's put is in flight. (2) DELETE /ops/nodes/A revokes L1 and requeues the job. (3) Node B claims and gets L2, then posts ok. B's head returns null or already sees A's object. B's put with etagDoesNotMatch '*' returns null because A's object landed first, so wrote=false. B's endLease completes L2 and the job becomes `done`. (4) A's endLease fails. discardTranscript reads L1 as `revoked`, head shows lease_id L1, and it deletes the object. End state: the job is `done` with no transcript in R2, and `GET /ops/transcripts` gives 404. No later result can repair it, because the job is never handed out again (8.7). The same happens when B's head runs after A's put. B skips its write, then A deletes. The 'write, then delete if stale' approach is not safe as long as another lease can rely on the object A wrote. The decision line in docs/decisions.md does not cover this case, and no test covers it.

- **minor** (`worker/src/node.ts:252`) pinLease moves lease_expires_at past claim time + LEASE_SECONDS on every ok attempt, including ones that end in 503

  8.3 sets lease_expires_at = now + LEASE_SECONDS at claim time. pinLease raises it to now + LEASE_SECONDS on every ok result that passes the check, and keeps the new value when the R2 write fails with 503. A node that keeps retrying after storage errors therefore holds the job past its original expiry, and GET /ops/jobs shows a later lease_expires_at than the one the claim returned. The change is written down in docs/decisions.md. It loses no data, but it differs from the expiry rule the spec states.

- **minor** (`worker/src/node.ts:168`) job.stale_result is also logged for a stale /node/release

  Section 8.4 step 2 names job.stale_result for results. checkLease logs it for releases too, so a log reader would count stale releases as stale results. It is harmless, but the docs do not mention it.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of 8.4 to 8.8 is in place: one conditional batch per lease end, a claim gated on revoked_at, the sweep, release and revocation. But discardTranscript (worker/src/node.ts:211-218) can delete the R2 object that another lease's `done` job relies on. That breaks 6.4/C5 (a stored transcript is never lost or overwritten) and leaves a `done` job with no transcript.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: no changed file matches `paths`.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of 8.4 to 8.8 is in place: one conditional batch per lease end, a claim gated on revoked_at, the sweep, release and revocation. But discardTranscript (worker/src/node.ts:211-218) can delete the R2 object that another lease's `done` job relies on. That breaks 6.4/C5 (a stored transcript is never lost or overwritten) and leaves a `done` job with no transcript.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/results.test.ts covers each acceptance criterion: ok/R2 metadata, idempotent retry, no_transcript, unavailable/blocked/error up to failed_video, expiry exactly at lease_expires_at with a fake clock, each 422 rule, release, revocation, and a claim racing a revocation. The e2e tests cover E2E-13/14/16/20/21. One gap: no test covers the delete race in the blocking finding.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  14 new dated lines cover the sweep placement, nulling the lease fields on done, the R2 head plus onlyIf write, the validation reason codes, pinLease, the claim gated on revoked_at, and discarding a stale write. The older line saying the sweep is not run yet is explicitly superseded.

## Proposed learnings (not decided)

- R2 has no transaction with D1, so cleaning up a stale write after the fact is only safe if nothing else can rely on the object meanwhile. When the 'unless an object exists' rule lets a later lease skip its own write, deleting the earlier object loses the transcript.
- When a fix adds a compensating delete, follow the other lease's path through the same window (claim, head, put with onlyIf, complete) and not only the original request's path.

## Earlier findings

- 0.1: fixed
- 0.2: fixed
- 0.3: still open, now findings 0
- 1.1: replaced, caused findings 0
- 1.2: still open, now findings 0

## Circled

- round 0: Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more. → round 1 (`worker/src/node.ts:236`): A revocation during the R2 write leaves a stored transcript for a revoked lease, and the result then answers 409 stale_lease → round 2 (`worker/src/node.ts:217`): discardTranscript can delete the transcript a later lease's `done` job depends on (data loss)
