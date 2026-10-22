# Review 1

- Reviewed commit: `43fa12ec91acfaa29a183ca167bc6f558db1d229`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/node.ts:236`) A revocation during the R2 write leaves a stored transcript for a revoked lease, and the result then answers 409 stale_lease

  Section 8.4 step 2 says a stale lease gets 409 and nothing is written (no R2 write). Section 8.8 says each active lease of a revoked node becomes revoked. Follow `POST /node/result` with outcome ok: (1) authenticate: the node is not yet revoked; (2) sweepExpired; (3) checkLease: the lease is active and not expired; (4) pinLease: a D1 batch that pushes `expires_at` forward. Then a concurrent `DELETE /ops/nodes/<id>` runs: it sets `revoked_at`, and revokeLeases → endLease('revoked') sets the lease to `revoked` (that UPDATE only checks `state = 'active'`; the pin does not stop it) and requeues the job. (5) storeTranscript runs `R2.put` and writes `transcripts/<id>.json` with this lease's metadata; (6) endLease('completed') matches nothing; (7) lostRace → checkLease finds `revoked` → logs job.stale_result and answers 409. So the R2 write lands between the guard (pin/check, step 4) and the decision (step 6), and revocation can interleave between them. The pin fixed this for expiry, but not for revocation. The effect: an object from a revoked node, written under a revoked lease, is kept for good (6.4 says never overwritten). When the requeued job goes to another node, that node's `ok` sees the object with `head` and skips its write, so its real transcript is lost and the job ends `done` with the revoked node's data. This loses data and breaks the revocation security property. It is the same class as round-0 finding 0.1. The same window also opens on expiry if the R2 write takes longer than LEASE_SECONDS (2 s in the e2e stack), since the pin only lasts until now + LEASE_SECONDS. Possible fixes: delete the object this request wrote (known from the `put` return value) when the final endLease does not apply; or make revocation and the sweep respect a pinned/writing lease. No test covers a revocation during the write.

- **minor** (`worker/src/lease.ts:60`) pinLease changes a job's visible lease_expires_at, which 8.3 defines as claim time + LEASE_SECONDS

  During an ok result, `GET /ops/jobs` can show a `lease_expires_at` later than the one the claim answered. This is in docs/decisions.md and is harmless in itself, but it is behaviour the spec does not describe, and it does not fully close the window (see the blocking finding).

- **minor** (`worker/src/node.ts:232`) Concurrent results with different outcomes on one lease can leave an R2 object for a lease whose accepted answer was a failure

  Request A (ok) pins the lease and writes R2. Request B (error) on the same lease completes first with `queued`. A's endLease then fails and A replays B's answer. R2 holds A's transcript while the job is requeued, and every later `ok` from another node is skipped by `head`. Only a node sending conflicting results can cause this. No acceptance criterion covers it.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The endpoints, sweep, failure handling, revocation, logs and e2e scenarios are all present. But a result whose lease is revoked during its R2 write writes to R2 and then answers 409 stale_lease, which breaks 8.4 step 2 and 8.8 (blocking finding 0).

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

  The endpoints, sweep, failure handling, revocation, logs and e2e scenarios are all present. But a result whose lease is revoked during its R2 write writes to R2 and then answers 409 stale_lease, which breaks 8.4 step 2 and 8.8 (blocking finding 0).

- met: The change is covered by tests that fail without it.

  worker/tests/workers/results.test.ts covers result, release, expiry (including the exact boundary with fake timers), validation (422 for each rule), revocation, the transcripts route and the log events. e2e/tests/results.api.spec.ts and claims.api.spec.ts cover E2E-13, 14, 16, 20 and 21. All of these exercise routes that are new in this change. One case is untested: a revocation during the R2 write.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md has 13 new dated lines: sweep placement, done clearing the lease fields, the sweep condition, the response/attempts coupling, node_events through changes(), R2 head plus onlyIf, a 404 for ids that are not video ids, validation reason codes, a 400 for a schema-breaking transcript, log levels, pinLease, the claim revocation guard and the single Playwright worker.

## Proposed learnings (not decided)

- When a fix guards an external write (R2) against one D1 actor that ends a lease (the sweep), check every other actor that can end the same lease (revocation, release, a concurrent result) against the same window.
- An R2 write that cannot share a transaction with D1 needs a compensating step (delete what this request wrote) or a lease state that every terminating actor respects; a time-based pin covers only time-based expiry.

## Earlier findings

- 0.1: fixed
- 0.2: fixed
- 0.3: still open, now findings 0

## Circled

- round 0: Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more. → round 1 (`worker/src/node.ts:236`): A revocation during the R2 write leaves a stored transcript for a revoked lease, and the result then answers 409 stale_lease → still open in round 1
