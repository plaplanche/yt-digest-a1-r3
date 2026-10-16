# Checks

Replayed by Ariane on commit `7a36d222a1371ca13f39f21affbd427c3e84c69e`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 9.1 s |
| contracts | yes | pass | 4.8 s |
| test-node | yes | pass | 11.2 s |
| test-worker | yes | pass | 4.2 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 9.1 s)

```text
(44 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 10 source files

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

/home/user/yt-digest-a1-r3.ariane/worktrees/5-replay/worker/src/contracts/log-event.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/5-replay/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 2 problems (0 errors, 2 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 4.8 s)

```text
== contracts

added 140 packages, and audited 141 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 32 packages in 1ms
Checked 31 packages in 0.36ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 11.2 s)

```text
(5 earlier lines omitted)
added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/5-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 25 items

node/tests/test_cleaning.py ...........                                  [ 44%]
node/tests/test_contracts.py .........                                   [ 80%]
node/tests/test_log.py ....                                              [ 96%]
node/tests/test_placeholder.py .                                         [100%]

============================== 25 passed in 7.67s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 4.2 s)

```text
== test-worker

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/5-replay/worker


 Test Files  3 passed (3)
      Tests  7 passed (7)
   Start at  21:29:12
   Duration  250ms (transform 66%, import 23%, tests 6%, worker 5%)
```

Summary: 4 passed, 0 failed (0 blocking).
