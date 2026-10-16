# Checks

Replayed by Ariane on commit `5aeefb0ff9fdc1640ae5256450453e6f54ca893c`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.7 s |
| contracts | yes | pass | 5.9 s |
| test-node | yes | pass | 11.5 s |
| test-worker | yes | pass | 4.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.7 s)

```text
(44 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 8 source files

added 140 packages, and audited 141 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

/home/user/yt-digest-a1-r3.ariane/worktrees/3-replay/worker/src/contracts/log-event.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/3-replay/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 2 problems (0 errors, 2 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 5.9 s)

```text
== contracts

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 32 packages in 1ms
Checked 31 packages in 0.32ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 11.5 s)

```text
(4 earlier lines omitted)

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/3-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 14 items

node/tests/test_contracts.py .........                                   [ 64%]
node/tests/test_log.py ....                                              [ 92%]
node/tests/test_placeholder.py .                                         [100%]

============================== 14 passed in 7.71s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 4.0 s)

```text
== test-worker

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/3-replay/worker


 Test Files  3 passed (3)
      Tests  7 passed (7)
   Start at  21:22:12
   Duration  225ms (transform 69%, import 16%, worker 7%, tests 7%)
```

Summary: 4 passed, 0 failed (0 blocking).
