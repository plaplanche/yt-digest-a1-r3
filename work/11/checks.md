# Checks

Replayed by Ariane on commit `796477899b036fc1ccc628be00e6dd648acd86e3`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.6 s |
| contracts | yes | pass | 5.1 s |
| test-node | yes | pass | 29.5 s |
| test-worker | yes | pass | 4.3 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.6 s)

```text
(45 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 18 source files

added 140 packages, and audited 141 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

/home/user/yt-digest-a1-r3.ariane/worktrees/11-replay/worker/src/contracts/log-event.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/11-replay/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 2 problems (0 errors, 2 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 5.1 s)

```text
== contracts

added 140 packages, and audited 141 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 33 packages in 1ms
Checked 32 packages in 0.39ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 29.5 s)

```text
(9 earlier lines omitted)

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/11-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 93 items

node/tests/test_cleaning.py ...........                                  [ 11%]
node/tests/test_cli.py .......................                           [ 36%]
node/tests/test_contracts.py .........                                   [ 46%]
node/tests/test_extractors.py ...........................                [ 75%]
node/tests/test_log.py ....                                              [ 79%]
node/tests/test_paging.py .......                                        [ 87%]
node/tests/test_placeholder.py .                                         [ 88%]
node/tests/test_sponsorblock.py ...........                              [100%]

============================= 93 passed in 25.22s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 4.3 s)

```text
== test-worker

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/11-replay/worker


 Test Files  3 passed (3)
      Tests  7 passed (7)
   Start at  22:52:32
   Duration  240ms (transform 65%, import 23%, tests 7%, worker 4%)
```

Summary: 4 passed, 0 failed (0 blocking).
