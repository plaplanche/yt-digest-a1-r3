# Review 0

- Reviewed commit: `9908603e24a689314576b34024c917df848113af`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/package-lock.json:125`) `@cloudflare/vitest-pool-workers` is deprecated and pulls in an alpha Miniflare

  The lock file marks 0.23.0 as deprecated: "@cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates." It also brings in `miniflare` 5.20260815.0-alpha. Because of it, Vitest drops from 5 to ~4.1.12 and the lock file is written with `--legacy-peer-deps`. docs/decisions.md calls 0.23.0 "its newest release" and does not mention the rename. The checks pass, so nothing is broken today, but the test toolchain now rests on a package that gets no updates. It is worth checking whether `@cloudflare/vitest-plugin` supports Vitest 5, and recording the rename in the decision line.

- **minor** (`worker/src/ops.ts:48`) Reset is two separate steps (D1 batch, then R2 paging)

  Order of writes in POST /ops/reset: (1) one D1 batch that runs DELETE on all 10 tables, all-or-nothing; (2) repeated R2 list on `transcripts/` followed by a bulk delete of each page. If R2 fails partway, D1 is already empty and some transcripts are left. A retry deletes them, so the operation is idempotent. No route in this ticket writes to R2 or D1 at the same time, and the spec does not ask for reset to be atomic. This is a test helper, so it is acceptable. It is worth knowing once /node/result (a later ticket) can write a transcript between steps 1 and 2.

- **minor** (`worker/src/ops.ts:37`) The Bearer scheme is matched case-sensitively

  `/^Bearer (.+)$/` rejects `bearer <token>` (401). Section 7 writes the header literally as `Authorization: Bearer $OPS_TOKEN` and no acceptance criterion covers other casings. Rejecting them fails closed, so security is not affected.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: no changed file matches `paths`.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  wrangler.toml matches section 2: main, compatibility_date, DB/yt-digest with migrations_dir "migrations", TRANSCRIPTS/yt-digest-transcripts, no account id and no route. 0001_init.sql creates every table and column of 6.3, with hourly_budget defaulting to 60 and the (video_id, kind) primary key. GET /health returns {status, version from package.json} (6.2). Unknown routes and methods return 404 not_found with the 4.2 body and Content-Type application/json (6.1). /ops/*: 404 when OPS_TOKEN is empty or unset, then the bearer is checked with a constant-time SHA-256 digest compare before any routing or body read, giving 401 unauthorized. POST /ops/reset empties all 10 tables and pages through R2 deleting everything under transcripts/. auth.bearer.rejected is logged with surface ops and reason missing/unknown, which matches the section 12 catalogue. No out-of-scope routes, mocks or stack.sh were added. No endpoint in this ticket reads a body, so 400 invalid_request has nothing to apply to yet.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/worker.test.ts runs in Miniflare through the pool-workers plugin, with migrations applied by applyD1Migrations in setup.ts. It covers: the columns of every 6.3 table via pragma_table_info, the default and the primary key; /health status, body and Content-Type; 404 not_found for unknown paths and methods; 401 on /ops with no bearer, a wrong bearer (with several bodies), another scheme, a token prefix or a token with an extra character; 404 when OPS_TOKEN is empty or unset, even with the right bearer; reset emptying all 10 tables and 1100 transcripts/ objects (more than one list page) while keeping other prefixes. Before this change there was no fetch handler, so all of these would fail. test-worker passed.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated 2026-10-22 lines cover: the pool-workers and Vitest 4 move with --legacy-peer-deps, the two Vitest projects, the placeholder database_id and compatibility_date, OPS_TOKEN as a plain variable, the CHECK constraints, the default and unique token_hash, the indexes, authentication before routing (an unknown /ops route is 401 without the bearer and 404 with it), the compare on SHA-256 digests, the reset order (D1 batch, then R2 pages) keeping other prefixes, and the added type packages.

## Proposed learnings (not decided)

- Before writing "newest release" in decisions.md, check npm for deprecation and rename notices: @cloudflare/vitest-pool-workers is now @cloudflare/vitest-plugin.
- The local replay skips test-node when its paths do not match, but test-node.sh runs `npm ci --prefix worker`. A change to worker/package-lock.json is still exercised by lint, contracts and test-worker, which run the same install.
- For reset-style endpoints that touch both D1 and R2, list the writes in order: D1 batch first, then R2 pages. Do this again when later routes write R2 at the same time.
