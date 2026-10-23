# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `21a2aa8f436209aab8e3ee6c2ccb663107684f95`.

Each check was replayed in its own clean working tree at `21a2aa8f436209aab8e3ee6c2ccb663107684f95`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 28.1 s |
| contracts | yes | pass | 24.1 s |
| test-node | yes | skipped | 0.0 s |
| test-worker | yes | pass | 19.8 s |
| e2e | yes | pass | 82.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 28.1 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/35-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/35-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/35-replay-1/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 10 problems (0 errors, 10 warnings)
  0 errors and 10 warnings potentially fixable with the `--fix` option.


added 104 packages, and audited 105 packages in 2s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 24.1 s)

```text
(33 earlier lines omitted)
 + markupsafe==3.0.4
 + more-itertools==11.2.1
 + mypy==2.4.0
 + mypy-extensions==1.1.0
 + packaging==26.3
 + pathspec==1.1.1
 + platformdirs==4.13.3
 + pluggy==1.7.0
 + pydantic==2.14.1
 + pydantic-core==2.50.1
 + pygments==2.21.0
 + pytest==9.1.1
 + pytokens==0.4.1
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/35-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Skipped: no changed file matches `paths`

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 19.8 s)

```text
(1250 earlier lines omitted)
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-23T04:46:12.205Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-23T04:46:12.205Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-23T04:46:12.206Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/invites.test.ts[2m > [22m[2minvites[2m > [22m[2mthe endpoints need the operator bearer
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-23T04:46:12.955Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/invites.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 103[2mms[22m[39m
 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 3002[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 2879[2mms[22m[39m

[2m Test Files [22m [1m[32m10 passed[39m[22m[90m (10)[39m
[2m      Tests [22m [1m[32m183 passed[39m[22m[90m (183)[39m
[2m   Start at [22m 04:46:06
[2m   Duration [22m 9.04s[2m (transform 1.44s, setup 1.65s, import 1.39s, tests 8.67s, environment 2ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 82.0 s)
- Not run by this replay (CI only): `e2e/**/*browser*`
- Changed files it skips: `e2e/tests/oauth.browser.spec.ts`

```text
(73 earlier lines omitted)
  ✓  12 [api] › tests/google.api.spec.ts:157:1 › revoke answers 200 (9ms)
  ✓  13 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (15ms)
  ✓  14 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (11ms)
  ✓  15 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (10ms)
  ✓  16 [api] › tests/invites.api.spec.ts:6:1 › invites are lowercased, revocable and re-activable; users start empty (113ms)
  ✓  17 [api] › tests/mcp.api.spec.ts:8:1 › E2E-27: /mcp without token gets 401 and WWW-Authenticate; discovery documents are served and consistent (65ms)
  ✓  18 [api] › tests/mcp.api.spec.ts:28:1 › E2E-33: a revoked invite refuses the user's valid access token (205ms)
  ✓  19 [api] › tests/mcp.api.spec.ts:42:1 › E2E-37: a node token on /mcp and an access token on /node/* are refused (228ms)
  ✓  20 [api] › tests/oauth.api.spec.ts:32:1 › E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused (154ms)
  ✓  21 [api] › tests/oauth.api.spec.ts:53:1 › the consent page, then the fake Google sign-in, lead an invited user back to the client with a code (145ms)
  ✓  22 [api] › tests/oauth.api.spec.ts:91:1 › E2E-31: refresh rotation, and the reuse of an old refresh token revokes the family (194ms)
  ✓  23 [api] › tests/results.api.spec.ts:6:1 › E2E-14: a lease expires, the job goes to another node and the first node's late result is 409 (2.7s)
  ✓  24 [api] › tests/results.api.spec.ts:29:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (238ms)
  ✓  25 [api] › tests/results.api.spec.ts:44:1 › E2E-20: a revoked node is refused and its job is reassigned (210ms)
  ✓  26 [api] › tests/results.api.spec.ts:63:1 › E2E-21: /node/* responses hold no user data (200ms)

  26 passed (10.3s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
