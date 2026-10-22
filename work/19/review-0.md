# Review 0

- Reviewed commit: `1023454adb16a4b7c526a5aefb57396db69ae3ab`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/workers/node.test.ts:140`) Ordering test does not distinguish creation order from video_id order

  The test queues id(1),id(2) first, then id(3), then id(4) and id(5) at priority 7, and expects [id(4), id(5), id(1)]. For every pair, the job created earlier also has the smaller video_id. So an implementation ordering by `priority DESC, video_id ASC` without `created_at` would pass too. The acceptance criterion 'priority order then creation order' is not really tested. Queue a higher id in an earlier request than a lower id (e.g. enqueue id(9), then id(1)) and expect id(9) first.

- **minor** (`worker/src/ops.ts:107`) enqueued/existing is decided by a SELECT separate from the INSERT batch

  `enqueue` reads the existing ids (SELECT, line 107), then runs the INSERT … ON CONFLICT batch (line 117) as a separate step. Two concurrent `POST /ops/jobs` with the same new id can both pass the SELECT before either INSERT. Both then report the id in `enqueued` and both log `job.enqueued`. The stored job is still correct: it is inserted once and its priority is the max. Only the response and the log are wrong. Neither the ticket nor the spec asks about concurrent operator enqueues, and no data is lost, so this is minor. An `INSERT … ON CONFLICT DO NOTHING RETURNING` followed by the priority UPDATE, in one batch, would decide it in one step.

- **minor** (`worker/src/node.ts:83`) A retried claim leases more jobs (8.9 retry idempotence)

  If a claim response is lost and the node retries, the retry leases new jobs; the first ones stay `leased` until expiry. Section 8.9 says a retry of any `/node/*` request has no side effect beyond the first. The claim request carries no idempotency key, so the spec leaves this to lease expiry, which belongs to the next ticket (out of scope). Worth a line in docs/decisions.md.

- **minor** (`worker/tests/workers/node.test.ts:160`) LEASE_SECONDS from the environment is not tested

  The test environment never sets LEASE_SECONDS, so only the default of 600 is covered. No test shows that a configured value is used, or that an invalid value falls back to the default as decided in docs/decisions.md.

- **minor** (`worker/src/validate.ts:71`) priority has no upper bound

  `isInteger(value.priority, 0)` accepts integers beyond Number.MAX_SAFE_INTEGER (e.g. 1e300). These are bound to D1 as REAL or may fail with a 500 instead of a 400. The schema sets no maximum, so this is minor.

- **minor** (`worker/src/ops.ts:140`) A malformed video_id on GET /ops/jobs gives 404 without a decisions.md line

  `jobStatus` answers 404 `not_found` for a path segment that is not a valid video id, instead of 400. This is a reasonable choice the spec leaves open, but docs/decisions.md does not record it.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Present: POST /ops/nodes (token `ytd_node_` + 43 base64url characters, only its SHA-256 hex stored, 409 on an existing id), POST /ops/jobs (request order, priority only raised via max()), GET /ops/jobs/<id>, the node auth of 8.1 (missing, unknown and revoked all 401, checked before the body), heartbeat answering healthy/run/hourly_budget, and claims built as one conditional UPDATE…RETURNING plus a leases INSERT in a single D1 batch (eligibility, order, lease fields, attempts+1, tried_nodes appended, LEASE_SECONDS). The five log events are present with the catalogue attrs. Left out and recorded in decisions.md: the expiry sweep, result and release, which belong to the next ticket. The stack.sh `--var NAME:value` fix is needed for LEASE_SECONDS and OPS_TOKEN to reach the Worker, and is documented.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/node.test.ts covers: 401 with no bearer, an unknown token and the operator token on both routes; heartbeat; empty queue; default of 3; priority order; leased/attempts/tried_nodes; tried_nodes exclusion; enqueue keeps the job and only raises priority; and concurrent claims on the local D1 (16 of 20 distinct, then 4 nodes sharing the 4 left, then 3×3 under contention). e2e/tests/claims.api.spec.ts: 2 nodes claim 6 jobs concurrently, and each job is handed out once. All of these fail without the change. One gap (minor finding): the ordering test does not distinguish created_at order from video_id order.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Recorded with dates: hand-written validators, 400 on an empty body, 404 before auth on /node/*, the claim batch design and lease id format, the LEASE_SECONDS fallback, a shared created_at per enqueue request plus handling of duplicate ids, job.enqueued logged once per request, the expiry sweep postponed, and the stack.sh --var form. Not recorded (minor): 404 for a malformed video id on GET /ops/jobs, and claim retry behaviour.

## Proposed learnings (not decided)

- When a test checks a 'then by X' ordering rule, build data where X and the next tie-breaker (here video_id) disagree; otherwise the test cannot fail on the rule.
- Decisions like 'new vs existing' should come from the write itself (INSERT … ON CONFLICT DO NOTHING RETURNING in a batch), not from a SELECT made before it.
- wrangler dev reads --var only as NAME:value; with NAME=value the Worker receives every setting empty. This silently disabled /ops until this ticket.
