# Review 0

- Reviewed commit: `f61a5a7f4975edfc70b2fd2b5802997c37ddcff6`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/daemon.py:122`) worker.call for result/release carries no top-level video_id

  spec/lot-2.md section 12 says '`video_id` is the top-level field whenever a job is concerned'. The worker.call lines for /node/result and /node/release concern one job, but _call emits only endpoint/status/duration_ms. Pass video_id=job.video_id for those calls, or record in docs/decisions.md why worker.call never carries it. No acceptance criterion covers this.

- **minor** (`node/src/yt_digest_node/daemon.py:118`) http.client.HTTPException (IncompleteRead, BadStatusLine) is not handled as a network error

  _call catches only OSError and ValueError. http.client.IncompleteRead raised by response.read(), or a malformed status line other than RemoteDisconnected, escapes. The daemon then crashes with a Python traceback (a non-JSON line on stderr), exits without releasing the other claimed jobs, and never makes the planned retry. Nothing is lost because the leases expire, but the spec's 'network error ... is retried' and 'stderr holds only log lines' are broken in that case. Catching http.client.HTTPException with the network errors would fix it.

- **minor** (`node/src/yt_digest_node/daemon.py:189`) No fetch.transcript line when the pipeline raises

  Section 9 asks for one fetch.transcript per job. That event is emitted inside run_transcript only on success, so a pipeline exception sends outcome 'error' with no fetch.transcript line for that job.

- **minor** (`node/src/yt_digest_node/daemon.py:213`) A SIGTERM that lands during the between-jobs heartbeat still starts the next job

  handle() checks self.stopping before the inter-job heartbeat, not after it. A signal that arrives while that heartbeat is in flight lets process() start a job that had not started, instead of releasing it. Signal handlers are also installed only after service.started is logged, so a very early SIGTERM uses the default action. Neither case loses data: the result is still posted or the lease expires.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: no changed file matches `paths`.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  daemon.py implements section 9. Variables, defaults and the 1-10 range are in read_settings; a missing WORKER_URL/NODE_TOKEN exits 2 before any request. The cycle is heartbeat, claim, then for each job the in-process run_transcript and a result with outcome = status and transcript only when ok; an exception sends 'error'. Network errors and 5xx on result/release are retried after 1/2/4 s and 4xx are not. --once exits 1 on a failed heartbeat or claim, and a 401 exits 1. SIGTERM/SIGINT finish the job in progress and release the rest. worker.call has endpoint/status(0 on a network error)/duration_ms. All requests and responses use the generated contracts. Nothing out of scope (OAuth, MCP, health states) was added. The only gap is the possibly missing top-level video_id on worker.call (minor).

- met: The change is covered by tests that fail without it.

  node/tests/test_daemon.py runs the CLI against a local fake Worker and covers: heartbeat + claim + one result per job with outcome/transcript, the pipeline exception sending error, 503 retried then success, 409 not retried, a failed claim/heartbeat exiting 1, a missing NODE_TOKEN exiting 2 with no request, SIGTERM releasing jobs not started and exiting 0, stderr holding only JSON lines without the token, and the loop polling. e2e/tests/daemon.api.spec.ts runs `work --once` on the stack and reads GET /ops/transcripts/sponsored01. The `work` command does not exist before the change, so all of them fail without it. The checks Ariane replayed pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Eight new dated lines cover: urllib with a 30 s timeout, worker.call per request at warn on non-2xx, loop behaviour on a failed heartbeat or claim, dropping a result after its retries, the meaning of jobs_in_progress and the extra heartbeat between jobs, result/release bodies not being read, exit 2 on bad numeric settings, and the signal flag with 0.1 s waits. The reading of video_id on worker.call is the only possibly open point not recorded (minor).

## Proposed learnings (not decided)

- For Python HTTP clients built on urllib, check that http.client.HTTPException (IncompleteRead, BadStatusLine) counts as a network error; it is not an OSError.
- Section 12's rule 'video_id is top-level whenever a job is concerned' also applies to node-side events such as worker.call on result/release; check it in log reviews.
- For a graceful stop, check the stop flag right before starting each job, after any intermediate call such as a heartbeat.
