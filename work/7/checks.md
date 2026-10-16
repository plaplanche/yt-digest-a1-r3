# Checks

Replayed by Ariane on commit `6f467e2a98058909de64d62ae788c16e776492ff`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.6 s |
| contracts | yes | pass | 4.8 s |
| test-node | yes | pass | 15.2 s |
| test-worker | yes | pass | 4.1 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.6 s)

```text
(44 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 12 source files

added 140 packages, and audited 141 packages in 2s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

/home/user/yt-digest-a1-r3.ariane/worktrees/7-replay/worker/src/contracts/log-event.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/7-replay/worker/src/contracts/transcript-result.ts
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
Checked 31 packages in 0.37ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 15.2 s)

```text
(6 earlier lines omitted)

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/7-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 36 items

node/tests/test_cleaning.py ...........                                  [ 30%]
node/tests/test_contracts.py .........                                   [ 55%]
node/tests/test_log.py ....                                              [ 66%]
node/tests/test_placeholder.py .                                         [ 69%]
node/tests/test_sponsorblock.py ...........                              [100%]

============================= 36 passed in 11.53s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 4.1 s)

```text
== test-worker

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/7-replay/worker


 Test Files  3 passed (3)
      Tests  7 passed (7)
   Start at  21:35:26
   Duration  269ms (transform 67%, import 21%, tests 8%, worker 4%)
```

Summary: 4 passed, 0 failed (0 blocking).
