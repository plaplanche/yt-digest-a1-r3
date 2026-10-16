# Checks

Replayed by Ariane on commit `ceea2f01ef07749745b83b763eed9f3a749ea6ed`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 9.0 s |
| contracts | yes | pass | 6.0 s |
| test-node | yes | pass | 21.2 s |
| test-worker | yes | pass | 4.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 9.0 s)

```text
(45 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 14 source files

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

/home/user/yt-digest-a1-r3.ariane/worktrees/9-replay/worker/src/contracts/log-event.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/9-replay/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 2 problems (0 errors, 2 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 6.0 s)

```text
== contracts

added 140 packages, and audited 141 packages in 3s

47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 33 packages in 1ms
Checked 32 packages in 0.38ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 21.2 s)

```text
(7 earlier lines omitted)
47 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/9-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 63 items

node/tests/test_cleaning.py ...........                                  [ 17%]
node/tests/test_contracts.py .........                                   [ 31%]
node/tests/test_extractors.py ...........................                [ 74%]
node/tests/test_log.py ....                                              [ 80%]
node/tests/test_placeholder.py .                                         [ 82%]
node/tests/test_sponsorblock.py ...........                              [100%]

============================= 63 passed in 16.48s ==============================
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

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/9-replay/worker


 Test Files  3 passed (3)
      Tests  7 passed (7)
   Start at  22:41:55
   Duration  318ms (transform 65%, import 22%, tests 9%, worker 4%)
```

Summary: 4 passed, 0 failed (0 blocking).
