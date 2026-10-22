# Review 0

- Reviewed commit: `20c841663031e48c40e96f3e3f32dd2f49d399de`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/node.ts:231`) A result can write to R2 for a lease that expires during the request, then answer 409 stale_lease

  In `result`, the lease check (`checkLease`, a SELECT) and the write that ends the lease (`endLease`, a batch) are separate statements, and the R2 put in `storeTranscript` runs between them. The order of writes on the `ok` path is: (1) sweepExpired, (2) checkLease reads the lease as `active`, (3) R2 head, then put of `transcripts/<id>.json` with node A's lease_id in its metadata, (4) endLease batch, conditional on `state = 'active'`. Here is an interleaving that breaks it. Node A's lease is about to expire and A passes step 2. Any other `/node/*` request or a `GET /ops/jobs/<id>` then runs `sweepExpired`: the lease becomes `expired`, the job goes back to `queued`, and node B may claim it. A then does step 3 and the object is stored. A's step 4 matches no row, so `lostRace` answers 409 `stale_lease`. Spec 8.4 step 2 says a stale lease writes nothing ('no R2 write', C2), but A's transcript is now in R2. When B later sends a valid `ok`, `head` finds A's object and skips the write, so the stored transcript and its metadata (node_id, lease_id) belong to a lease that ended as expired. The stored data is wrong, and C2 is broken. The R2 write needs a guard that a concurrent sweep cannot interleave. For example: before the put, a conditional UPDATE that pins the lease (it stays `active` but the sweep is told not to expire it, or its expiry is pushed out), released by the final batch or on a 503. No test covers this case.

- **blocking** (`worker/src/ops.ts:162`) A claim that runs at the same time as a revocation leaves an active lease held by the revoked node

  `revoke` runs these writes in order: (1) UPDATE nodes SET state='disabled', revoked_at; (2) `revokeLeases`, which SELECTs the node's active leases; (3) one endLease batch per lease. `claim` (node.ts:86-112) checks `revoked_at` only at authentication, a SELECT before the body is read, and its UPDATE/INSERT batch does not check again that the node is still not revoked. Interleaving: the claim authenticates while the node is still active, then steps 1 and 2 of the revocation run, finding no lease, and then the claim's batch leases jobs to the revoked node and inserts new `active` leases rows. Spec 8.8 says 'Each active lease of the node becomes revoked' and the job is failed over with `lease_revoked`. Here the lease stays active, the job stays `leased` to a node whose token now gets 401, and it waits for the lease to expire (LEASE_SECONDS, 600 s by default). It is then recorded as `lease_expired`, not `lease_revoked`. The decision is split across separate statements. A fix is to make the claim's UPDATE conditional on `EXISTS (SELECT 1 FROM nodes WHERE node_id = ?1 AND revoked_at IS NULL)`, or to run the node update and the lease revocation in one batch that the claim's batch cannot interleave.

- **minor** (`worker/src/node.ts:224`) A lease that expires between the sweep and the lease check is still accepted

  Neither `checkLease` nor the `completed` endLease compares `leases.expires_at` with now. They rely only on the sweep that ran a moment earlier in the same request. A result that lands just after `lease_expires_at`, but after this request's sweep has run, is accepted. This follows the literal order of 8.4 (sweep, then check), but it widens the window of the first finding.

- **minor** (`worker/tests/workers/results.test.ts:276`) Duplicate validation case

  'a word_count that counts the […] page' builds the same body as 'a wrong word_count' (`word_count: 6`), so the case says nothing new. The […] exclusion is only exercised positively, at line 299.

- **minor** (`e2e/tests/claims.api.spec.ts:24`) E2E-13 may be timing-sensitive with LEASE_SECONDS=2

  The e2e stack runs with 2-second leases (scripts/checks/e2e.sh:28). E2E-13 runs 6 sequential GETs before it sends the results. On a slow runner the leases could expire first and the 200s would turn into 409s. It passed in 70.7 s here, but it could be flaky.

- **minor** (`worker/src/lease.ts:64`) No test for a sweep racing a result or a release

  The concurrency tests cover duplicate results only. There is no test of a result or release running concurrently with an expiry sweep or a revocation, which is where the two blocking findings are.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The endpoints, sweep, failure handling, revocation, R2 layout, node events and log events follow 6.4, 7, 8.4-8.9 and 12, and nothing outside the ticket was added. However, under concurrency a stale lease can still write to R2 and answer 409 (8.4 step 2 / C2, node.ts:231), and a claim that interleaves with DELETE /ops/nodes leaves an active lease that is never revoked (8.8, ops.ts:162).

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

  The endpoints, sweep, failure handling, revocation, R2 layout, node events and log events follow 6.4, 7, 8.4-8.9 and 12, and nothing outside the ticket was added. However, under concurrency a stale lease can still write to R2 and answer 409 (8.4 step 2 / C2, node.ts:231), and a claim that interleaves with DELETE /ops/nodes leaves an active lease that is never revoked (8.8, ops.ts:162).

- met: The change is covered by tests that fail without it.

  worker/tests/workers/results.test.ts exercises every acceptance criterion, including exact-expiry with fake timers, each 8.4 validation rule, idempotent retries, release and revocation. e2e/tests/results.api.spec.ts and claims.api.spec.ts cover E2E-13/14/16/20/21. All of them hit routes that did not exist before. The races in the blocking findings are not tested.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  11 dated lines were added: Playwright workers=1, where the sweep runs, lease fields nulled on done, the double expiry condition, the response_json/attempts condition, node events gated on changes(), head + onlyIf for R2, 404 for a malformed transcript id, the validation reason codes, 400 for a schema-breaking transcript, and log levels.

## Proposed learnings (not decided)

- When a handler writes to external storage (R2) between a D1 check and a D1 conditional write, check whether a concurrent sweep or revocation can end the lease in that window; the conditional final write alone does not undo the external write.
- A revocation that first flips the node row and then SELECTs its leases can be interleaved by a claim that authenticated earlier; the claim's write should itself be conditional on the node not being revoked.
- Short LEASE_SECONDS in e2e (2 s) makes tests that do many requests between claim and result timing-sensitive.
