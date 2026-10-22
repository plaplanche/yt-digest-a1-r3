2026-10-16: Python build backend is hatchling, with a `src/` layout, so `yt_digest_node` is installed in the uv environment.
2026-10-16: ESLint uses the flat config with `typescript-eslint` recommended rules; `worker/` is an ES module package (`"type": "module"`).
2026-10-16: Check scripts call tools through `uv run --project node` and `npm exec --prefix worker`, so they run from the repository root without `cd` into packages (except mypy, which runs from `node/` to pick up its config).
2026-10-16: Contracts are generated with `datamodel-code-generator` (dev dependency of `node`, Pydantic v2 output, `StrEnum` for every enum) and `json-schema-to-typescript` (dev dependency of `worker`); `pydantic` is a runtime dependency of `node`.
2026-10-16: Enums live under `$defs` in the schemas so the generated types are named (`LogEventName`, `TranscriptStatus`, ...); the catalogue is the `LogEventName` union in TypeScript and `LogEventName` `StrEnum` in Python.
2026-10-16: `attrs` is a free-form object in the log schema; the per-event attribute lists of spec 4.2 are not enforced by the schema.
2026-10-16: The TypeScript logger writes with `console.error`, and keeps its runtime catalogue as a `Record<LogEventName, true>` so the compiler flags drift from the generated union.
2026-10-16: The generated package `contracts/` has a hand-written empty `__init__.py`, which is not checked by `contracts.sh --check`.
2026-10-16: The `contracts` check script installs the tools (`npm ci --prefix worker`, `uv sync --locked --project node`); `scripts/contracts.sh` calls `json2ts` with `npm exec --no`, so it never falls back to the registry.
2026-10-16: The schemas declare draft 2020-12, which is where `$defs` belongs; `--check` also reports generated files whose schema no longer exists.
2026-10-16: The TypeScript side validates a transcript result at runtime with a small hand-written `parseTranscriptResult` (no JSON Schema library); the `test-node` check also runs `npm ci --prefix worker` because its `--check` tests use the worker tools.
2026-10-16: The TypeScript logger checks the types of `attrs`, `request_id` and `video_id` at runtime, as the Python logger does through its model.
2026-10-16: Segments are passed to `clean_cues` as a list of `(start, end)` tuples in seconds; the function returns the paragraphs as a list of strings (joining with `\n\n` is left to the caller).
2026-10-16: A "kept cue" (step 5) is a cue that still has at least one line after steps 3 and 4; the gap is measured from the last such cue, and compared in whole milliseconds so that 1.9 s and 2.0 s are exact.
2026-10-16: "The line kept just before" (step 4) is the last kept line across cues, not only within the cue.
2026-10-16: A cue block is recognised by a `-->` timing line in its first two lines (an optional identifier comes first); blocks without one are ignored, and a leading BOM and CRLF line ends are accepted.
2026-10-16: `fetch_segments(base_url, video_id, request_id=None)` returns segments as `(start, end)` tuples plus a state (`ok`, `none`, `error`); a 200 whose body is not the expected JSON counts as `error`; the call is logged at `info`, or `warn` on `error`, with `status`, `segments` and `duration_ms` in `attrs`.
2026-10-16: `sponsor_ratio` returns 0 when the duration is not positive, and ignores segments that are empty once clipped; the cue cut of step 2 was already in `clean_cues`.
2026-10-16: An extractor is a class with `extract(video_id, langs)` returning `"unavailable"`, `"blocked"` or an `Extraction(duration, tracks)`; `make_extractor(env)` picks the fake one on `FETCHER_FAKE_YTDLP=1` (error if `FAKE_YTDLP_DIR` is missing) and never delays it, whatever `YT_DELAY_SECONDS` says.
2026-10-16: The yt-dlp extractor maps an error by the lowercase text of its message (bot check → `blocked`; private, age-restricted, removed or terminated account → `unavailable`); any other error is raised; `yt-dlp` is a runtime dependency imported lazily.
2026-10-16: `YT_DELAY_SECONDS` is `a-b` or a single number, and a fake `meta.json` without `duration` gives 0.
2026-10-16: Language codes are matched exactly against the codes in `--langs` and in yt-dlp's subtitle keys (`en` does not match `en-US` or `en-orig`); the user lists the codes they want.
2026-10-16: `extract(video_id, langs)` takes the language order; the yt-dlp extractor downloads only the first track `choose_track` would pick (manual in language order, then auto), with the delay before that download as before `extract_info`, never the ~150 auto-translated ones; the fake extractor ignores `langs` and returns every track.
2026-10-16: A 403 or 429 on a subtitle download is `blocked`; other download errors are raised. The `unavailable` markers are only the spec's: private, age-restricted (`age-restricted`, `confirm your age`) and removed; anything else, YouTube's rate-limit text included, is raised.
2026-10-16: `choose_track` returns `None` when nothing matches (the caller maps it to `no_transcript`); a fake `meta.json` that is missing counts as `{}` (status ok, duration 0); fake `.vtt` files not named `<lang>.<manual|auto>.vtt` are skipped; an invalid `YT_DELAY_SECONDS` raises `ValueError`.
2026-10-16: `truncate` and `paginate` (in `paging.py`) work on the list of paragraphs; the `[…]` marker is a paragraph of its own and weighs 0 words in a page, and a paragraph longer than `PAGE_WORDS` is flushed alone: the current page is closed, and its chunks of `PAGE_WORDS` words each make one page (the last chunk is not completed with the next paragraph).
2026-10-16: The command exits 2, through argparse, on an invalid video id and on an invalid `MAX_WORDS`, `PAGE_WORDS` or `FAKE_YTDLP_DIR` configuration (non-integer, below 1, or missing); `service.started` is logged once the configuration is valid.
2026-10-16: SponsorBlock is only called when a track was chosen; the `fetch.transcript` attributes that do not apply (`source`, `words`, `pages`, `sponsor_ratio`, `sponsorblock`) are left out when the status is not `ok` or SponsorBlock failed; a track with no text left gives `ok` with no page and 0 words.
2026-10-16: The command is `yt_digest_node.cli:main`, installed as the script `yt-digest-node`; end-to-end tests run it with `python -m yt_digest_node.cli`.
2026-10-16: An exception raised by the extractor is not caught: the command exits 1 with a Python traceback on standard error and no `fetch.transcript` line.
2026-10-16: `--langs` is split on commas, entries are stripped and empty ones dropped; an empty `--langs` falls back to `TRANSCRIPT_LANGS`, then `fr,en`; a list with no entry left gives `no_transcript`, not exit 2.
2026-10-16: An invalid `YT_DELAY_SECONDS` is not checked by the command: the fake extractor ignores it, and the yt-dlp extractor raises `ValueError` (exit 1, as for any extractor exception).
2026-10-22: Contract tests in the Worker validate instances with ajv (2020-12 draft, a dev dependency), reading the schemas from `contracts/`; `tsconfig.json` gains `resolveJsonModule`.
2026-10-22: A cross-file `$ref` in a schema is resolved by `scripts/contracts.sh` by swapping it for a marker in a temporary copy (needs `jq`) and importing the other schema's generated type, so the type is never duplicated.
2026-10-22: Worker tests run with `@cloudflare/vitest-pool-workers` (its newest release, 0.23.0), which needs Vitest 4, so `worker/` moves from Vitest 5 to `~4.1.12`; the lock file is written with `--legacy-peer-deps` because npm 10 crashes on Vitest 4's peers, and `npm ci` installs it as is.
2026-10-22: Vitest runs two projects: `node` (`worker/tests/*.test.ts`, the contract tests, which need `ajv`'s code generation) and `workers` (`worker/tests/workers/`, inside Miniflare, migrations applied once per test file from `worker/migrations/` through `applyD1Migrations`).
2026-10-22: `wrangler.toml` holds a placeholder `database_id` (all zeros) because the local D1 needs one and the spec allows no account; `compatibility_date` is `2026-08-15`; `OPS_TOKEN` is a plain variable, set by the tests and later by `stack.sh`.
2026-10-22: The tables carry `CHECK` constraints for the enumerations of spec 6.3, `tried_nodes` defaults to `[]`, and `token_hash` is unique; three indexes serve the claim query and the lookups of later tickets.
2026-10-22: Every `/ops/*` request is authenticated before routing, so an unknown `/ops` route or method is 401 without the operator bearer and 404 with it; the constant-time compare is done on the SHA-256 digests of both values.
2026-10-22: `POST /ops/reset` deletes the rows in one D1 batch, then the R2 objects under `transcripts/` page by page; objects under other prefixes are kept.
2026-10-22: `worker/` gains `@cloudflare/workers-types` and `@types/node` (dev) so `tsc` knows D1, R2 and `vitest.config.ts`; the Worker code itself uses no Node API.
2026-10-22: The Worker's module exports only its handler (the placeholder `name` export is removed, with its test), because `workerd` refuses any other export on startup.
2026-10-22: `stack.sh` starts each process in its own session (`setsid`) so `down` can signal the whole group by its pid.
2026-10-22: `down` signals a pid file's group only if `/proc/<pid>/cmdline` still names `wrangler` or the mocks server, so a reused pid is left alone.
2026-10-22: `stack.sh` detects a taken port by trying to connect to it with bash's `/dev/tcp`.
2026-10-22: `stack.sh` runs `wrangler` from the repository root with `--config worker/wrangler.toml` (state in `.stack/state`).
2026-10-22: `stack.sh` passes every setting of section 5.2 to the Worker with `--var`.
2026-10-22: The mocks server answers any route other than `/health` with a 404 `Not Found`, which is the SponsorBlock answer of this ticket.
2026-10-22: Playwright's `api` and `browser` projects are told apart by the file suffix (`*.api.spec.ts`, `*.browser.spec.ts`).
2026-10-22: `e2e/` has its own ESLint flat config like `worker/`.
2026-10-22: `e2e.sh` copies `.stack/logs/` and the Playwright report to `ci-artifacts/` (git-ignored) from its EXIT trap whenever it fails, before the stack is stopped; the Playwright report and results folders are git-ignored.
2026-10-22: `e2e.sh` also checks the `stack.sh` lifecycle after the Playwright run: taken port, repeated `down`, empty state after a second `up`.
2026-10-22: Request bodies of the Worker are checked by hand-written validators in `worker/src/validate.ts` that mirror the schemas, as `transcript-result.ts` does, because Ajv generates code and `workerd` forbids that.
2026-10-22: An empty or non-JSON body of a `/node/*` or `/ops` POST is 400 `invalid_request`, even when every field is optional.
2026-10-22: On `/node/*`, a route or method that does not exist is 404 before authentication; `/node/result` and `/node/release` are 404 until their ticket.
2026-10-22: A claim is one D1 batch: an `UPDATE … WHERE (video_id, kind) IN (SELECT … ORDER BY … LIMIT) RETURNING` that leases the jobs, then an `INSERT OR IGNORE INTO leases … SELECT` from the jobs just leased by this node with this expiry; lease ids are `lease_` plus 32 hexadecimal characters from SQLite's `randomblob`.
2026-10-22: `LEASE_SECONDS` unset or invalid falls back to 600.
2026-10-22: `POST /ops/jobs` gives all the new jobs of a request the same `created_at`, so their order within a request is by `video_id`; a repeated id in one request is listed once in `enqueued` (or `existing`) and then in `existing`.
2026-10-22: `job.enqueued` is logged once per `POST /ops/jobs` that creates at least one job, with the count of new jobs.
2026-10-22: The expiry sweep of 8.6 is not run yet (expiry is the next ticket), so neither `/node/*` nor `GET /ops/jobs/<video_id>` sweeps.
2026-10-22: `stack.sh` hands each setting to `wrangler dev --var` as `NAME:value`, the only form wrangler reads (with `=` the Worker received every setting empty).
2026-10-22: Playwright runs with one worker, because every test starts from `POST /ops/reset` on the one shared stack.
2026-10-22: The expiry sweep of 8.6 now runs in every `/node/*` request after validation and in `GET /ops/jobs/<video_id>`; it supersedes the earlier line saying it is not run yet.
2026-10-22: A job that becomes `done` also gets `leased_by`, `lease_id` and `lease_expires_at` set to null, as a failed or requeued one does (the transcript's R2 metadata keeps the node and lease).
2026-10-22: The sweep expires a lease only when both the job's and the lease row's expiry are at or before now; both are written with the same value by a claim.
2026-10-22: The status in the answer of `/node/result` is computed from the job's attempts before the write and the write is conditional on those attempts, so the stored `response_json` equals the answer.
2026-10-22: A `node_events` row is inserted only when the job update of the same batch changed a row (`changes() > 0`), so a retry or a race records no second event; a revocation records no node event, as 6.3 has no kind for it.
2026-10-22: The R2 write checks for an existing object with `head` and also passes `onlyIf: {etagDoesNotMatch: "*"}`, so a concurrent writer cannot overwrite either.
2026-10-22: `GET /ops/transcripts/<video_id>` answers 404 `not_found` for an id that is not a video id.
2026-10-22: The `reason` of `job.validation_failed` is one of `transcript_missing`, `transcript_not_null`, `status_mismatch`, `video_id_mismatch`, `pages_empty`, `word_count_mismatch`.
2026-10-22: A `/node/result` or `/node/release` body whose `transcript` breaks the transcript-result schema is 400 `invalid_request`, before the lease check.
2026-10-22: `job.stale_result` is logged at level `warn`, with `video_id` when the lease exists; `job.validation_failed` likewise at `warn`.
2026-10-22: Before its R2 write a result pushes the lease expiry to now + LEASE_SECONDS (`pinLease`, conditional on the lease being active and unexpired), so a concurrent sweep cannot expire it mid-write; a lease whose `expires_at` has passed is refused by the lease check, `completed`/`rejected` ends and releases even if the sweep has not run.
2026-10-22: `claim` leases jobs only while the node is not revoked (the UPDATE checks `nodes.revoked_at` in the same statement), so a claim racing a revocation leases nothing.
2026-10-22: A result that wrote to R2 but then lost its lease (revoked or answered by a conflicting result mid-write) deletes the object it wrote, if its metadata still names that lease, before answering 409, unless the lease was completed by a copy of the same result.
2026-10-22: The daemon uses `urllib` (no new dependency); a request times out after 30 s, and a timeout counts as a network error (`worker.call` status 0).
2026-10-22: `worker.call` is logged once per HTTP request (each retry included), at `warn` when the status is not 2xx.
2026-10-22: In the loop, a failed heartbeat or claim (other than 401) is only logged by `worker.call`; the loop goes on, a failed claim waiting `POLL_SECONDS`. Only `--once` exits 1 on them.
2026-10-22: A result or release that fails after its retries is dropped and the daemon moves on (the lease expires on the Worker); this does not change the exit code.
2026-10-22: `jobs_in_progress` is the number of claimed jobs not yet answered; in the loop a heartbeat is also sent between two jobs when `HEARTBEAT_SECONDS` have passed.
2026-10-22: The bodies of `/node/result` and `/node/release` answers are not read (nothing in them is used); the heartbeat and claim answers are validated, and an invalid one counts as a failed call.
2026-10-22: `CLAIM_BATCH` outside 1 to 10 and a non-positive `POLL_SECONDS` or `HEARTBEAT_SECONDS` exit 2 without any request, like a missing variable.
2026-10-22: On SIGTERM or SIGINT the daemon only sets a flag; waits sleep in 0.1 s slices so the flag is seen quickly, and the job in progress (retries included) is finished before the release of the others.
2026-10-22: The fake Google rejects a token request whose client authentication is missing or wrong with 401 before looking at the grant; Basic credentials are percent-decoded, and a `/google/revoke` request is answered 200 with an empty body whatever it holds.
2026-10-22: The fake Google's refresh tokens are not rotated and live as long as the mocks server; every access token it issued stays valid for userinfo until the server stops.
2026-10-22: `POST /ops/invites` and its revoke twin emit no log event (the catalogue has none) and reject extra body fields with 400 `invalid_request`.
