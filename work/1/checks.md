# Checks

Replayed by Ariane on commit `fc986f154395218e42599bb04aa9c296dd199d45`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 6.3 s |
| contracts | yes | pass | 0.0 s |
| test-node | yes | pass | 0.6 s |
| test-worker | yes | pass | 2.8 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 6.3 s)

```text
(16 earlier lines omitted)
 + pluggy==1.7.0
 + pygments==2.21.0
 + pytest==9.1.1
 + ruff==0.17.1
 + typing-extensions==4.16.0
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/1-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
2 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 2 source files

added 129 packages, and audited 130 packages in 2s

41 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== contracts
scripts/contracts.sh does not exist yet: nothing to check
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 0.6 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 14 packages in 2ms
Checked 13 packages in 0.26ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/1-replay/node
configfile: pyproject.toml
collected 1 item

node/tests/test_placeholder.py .                                         [100%]

============================== 1 passed in 0.01s ===============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 2.8 s)

```text
== test-worker

added 129 packages, and audited 130 packages in 2s

41 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r3.ariane/worktrees/1-replay/worker


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  20:49:31
   Duration  217ms (transform 68%, import 22%, worker 5%, tests 5%)
```

Summary: 4 passed, 0 failed (0 blocking).
