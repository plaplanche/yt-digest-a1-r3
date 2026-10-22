# Review 1

- Reviewed commit: `2273e5fe27239e54881819f6406bbf09e33b4d11`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/stack.sh:34`) down skips a process group whose leader has exited

  `down` signals a group only if `/proc/<pid>/cmdline` of the leader (the `npm exec` process) still names wrangler or the mocks server. If that npm leader dies while its children (workerd, tsx/node) are still alive in the same group, the pid file is removed and the group is never signalled. The port stays taken, and the next `up` fails with "port is already taken". `kill -0 -- -$pid` on the group would catch this case. The spec does not cover it, and no data is lost.

- **minor** (`scripts/checks/e2e.sh:31`) Lifecycle checks hardcode ports 8787/8789 and go beyond the steps listed in section 3.1

  After the Playwright run, the script runs more `up`/`down` cycles (taken port, repeated down, marker file in `.stack/state`). These steps are not in the section 3.1 list of what e2e.sh runs. They are recorded in docs/decisions.md and they test the acceptance criteria, so this is acceptable. However, they hardcode 8787 and 8789 instead of using WORKER_PORT/MOCKS_PORT, so the check gives wrong results when those variables are set. Also, the 'mocks left running' check only proves that nothing started: `up` checks the ports before it launches anything.

- **minor** (`scripts/checks/e2e.sh:18`) `cp -r` nests a second copy if ci-artifacts/logs already exists

  Locally, a second failing run copies into `ci-artifacts/logs/logs` and keeps the stale logs at the top level. CI starts from a clean checkout, so CI is not affected.

- **minor** (`e2e/mocks/server.ts:16`) Mocks server does not read GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET yet (out of scope: ticket 07)

  Section 5.3 says the server reads these variables, but they are only used by the fake Google routes, which belong to ticket 07. stack.sh already passes them in, and a comment explains the gap.

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

  e2e/ package with Playwright projects api/browser and mocks/server.ts (/health 200 {status:ok}, SponsorBlock 404 Not Found). stack.sh follows 5.1 in this order: down, port check, npm ci if node_modules is missing, rm state, migrations with WRANGLER_SEND_METRICS=false, setsid mocks + wrangler dev on 127.0.0.1 with every 5.2 variable passed via --var (PUBLIC_URL=WORKER_URL), readiness on both /health, 'stack: ready' as the last line, fail→down→exit 1. Logs are truncated, and down signals process groups. .stack/ is git-ignored. e2e.sh follows 3.1: npm ci, CI-dependent chromium install, api-only fallback with the exact message, LEASE_SECONDS=2, and the trap always stops the stack. lint.sh covers e2e/, and ci/jobs.json has the e2e job. The only extras (removing the Worker's `name` export, lifecycle checks) are justified and recorded.

- met: The change is covered by tests that fail without it.

  e2e/tests/health.api.spec.ts checks the Worker /health, the mocks /health body and the SponsorBlock 404. e2e.sh also checks the taken-port exit 1, repeated down and the empty state after a second up. All of these fail without stack.sh or the mocks server. e2e was green in Ariane's replay.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  There are dated lines for setsid process groups, the /proc cmdline guard, /dev/tcp port detection, running wrangler from the repo root, --var, the mocks catch-all 404, project file suffixes, the e2e ESLint config, artifact collection in the EXIT trap, the lifecycle checks and the removed `name` export.

## Proposed learnings (not decided)

- Install the EXIT trap that collects artifacts before the first step that can fail with useful logs (here `stack.sh up`), so a startup failure still uploads .stack/logs.
- With `setsid cmd &` in a non-interactive bash, $! is the session/group leader; checking liveness of the leader alone misses orphaned children in its group — check the group (`kill -0 -- -pid`).
- Lifecycle checks inside a check script should use the same port variables as the script under test, not literals.

## Earlier findings

- 0.1: fixed
- 0.2: fixed
