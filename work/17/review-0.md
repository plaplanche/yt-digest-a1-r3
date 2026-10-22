# Review 0

- Reviewed commit: `a17db45b39f38a1e9ae05b8533b05a4a17efbb77`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`scripts/checks/e2e.sh:23`) Logs are not copied to ci-artifacts/ when the stack fails to start

  Section 3.1 says that on failure, e2e.sh copies .stack/logs/ and the Playwright report into ci-artifacts/. Here `collect` runs only when `npx playwright test` fails (line 24). Under `set -e`, a failing `LEASE_SECONDS=2 ./scripts/stack.sh up` (readiness timeout, a process that exits, D1 migrations failing, a port already taken) ends the script at line 23. The EXIT trap then runs `stack.sh down` and nothing is collected. The workflow uploads ci-artifacts/ only `if: failure()`, so the failure where worker.log and mocks.log matter most (the stack never got ready in CI) produces no artifact. Order of side effects on that path: (1) stack.sh writes .stack/logs/*.log, (2) stack.sh `fail` calls down and exits 1, (3) e2e.sh exits through set -e, (4) the trap runs down, (5) no copy. Fix: run `collect` from the EXIT trap whenever the exit status is not 0, before `stack.sh down`, or wrap `up` in `|| { collect; exit 1; }`.

- **minor** (`scripts/stack.sh:55`) No automated test for the port-taken, double-down and empty-state criteria

  These acceptance criteria are only exercised by hand: `up` with a taken port exits 1 and leaves nothing running, a second `down` exits 0, and a second `up` starts from an empty D1 and R2. e2e.sh only runs the happy path, so a regression in `port_taken`, `fail` or the `rm -rf .stack/state` step would not fail any check.

- **minor** (`scripts/stack.sh:33`) down signals the process group of a stale pid file without checking it

  `up` always calls `down` first. If a previous stack died and its pid was reused, `kill -TERM -- -$pid` and then `kill -KILL` hit an unrelated process group. The risk is low, but `down` could check that the group is still ours first, for example by comparing the command line.

- **minor** (`e2e/mocks/server.ts:14`) Redundant SponsorBlock branch; GOOGLE_CLIENT_ID/SECRET are not read yet

  The skipSegments branch does exactly what the default 404 branch does. Section 5.3 says the server reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. stack.sh passes them, but the server ignores them. That is acceptable until ticket 07 (out of scope), but worth a comment.

- **minor** (`docs/decisions.md:42`) Several decisions are packed into each dated line

  The project rule asks for one dated line per decision. Lines 42 to 45 combine unrelated choices: setsid with the removed export, /dev/tcp with --config with --var, and the 404 fallback with the project suffixes with the ESLint config.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  These are done: stack.sh follows 5.1 and 5.2 (down first, npm ci when node_modules is missing, state wiped, migrations, setsid background processes, --var for every 5.2 setting, WRANGLER_SEND_METRICS=false, readiness on both /health, truncated logs). The mocks server serves the two routes of 5.3, the e2e job is added to ci/jobs.json, lint covers e2e/, and .stack/ is ignored. But e2e.sh does not copy .stack/logs/ to ci-artifacts/ when `stack.sh up` fails, which 3.1 requires ('On failure it copies...'). Removing the Worker `name` export is justified (workerd refuses other exports) and recorded.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  These are done: stack.sh follows 5.1 and 5.2 (down first, npm ci when node_modules is missing, state wiped, migrations, setsid background processes, --var for every 5.2 setting, WRANGLER_SEND_METRICS=false, readiness on both /health, truncated logs). The mocks server serves the two routes of 5.3, the e2e job is added to ci/jobs.json, lint covers e2e/, and .stack/ is ignored. But e2e.sh does not copy .stack/logs/ to ci-artifacts/ when `stack.sh up` fails, which 3.1 requires ('On failure it copies...'). Removing the Worker `name` export is justified (workerd refuses other exports) and recorded.

- met: The change is covered by tests that fail without it.

  e2e/tests/health.api.spec.ts checks the Worker /health, the mocks /health ({status: ok}) and the SponsorBlock 404 'Not Found'. These tests cannot pass without stack.sh, the mocks server and e2e.sh. The stack.sh edge cases (port taken, second down, fresh state) have no automated test (minor finding).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  decisions.md records: setsid and group kill, the /dev/tcp port probe, wrangler run from the root with --config and --var, the mocks 404 fallback, the project suffixes, the e2e ESLint config, ci-artifacts and the ignored report folders, and removing the `name` export. The entries are packed several per line (minor finding).

## Proposed learnings (not decided)

- In check scripts that must collect artifacts 'on failure', put the collection in the EXIT trap keyed on a non-zero status, not on one command's `||`. Under `set -e`, earlier steps such as stack start-up can fail before the guarded command runs.
- The CI workflow uploads ci-artifacts/ only on failure, so a failure path that skips collection leaves no diagnostics at all.
