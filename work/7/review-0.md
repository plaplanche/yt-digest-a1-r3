# Review 0

- Reviewed commit: `9fa996ca89e43006e311d0a7793302d4d416c2cb`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/sponsorblock.py:50`) Some network errors escape fetch_segments: no `error` state and no log line

  The function only catches `HTTPError`, `OSError` and `ValueError`. Some failures raise `http.client.HTTPException` subclasses that are not `OSError`, and urllib does not wrap them in `URLError`. Examples: `IncompleteRead` from `response.read()` when the server closes before Content-Length is reached, `BadStatusLine` from a garbled status line, and `LineTooLong`. When that happens the exception propagates. Spec 5.3 requires every network error to give no segments and the `error` state, with the result otherwise produced normally, and it requires each call to log `sponsorblock.call`. Neither happens. Fix: also catch `http.client.HTTPException` around both `urlopen` and `read()`, treating it as status 0 (or keeping the HTTP status already read). Add a test whose handler declares a Content-Length larger than the body it sends and then closes.

- **minor** (`node/tests/test_sponsorblock.py:81`) The log level is not asserted

  The decision says the call is logged at `info`, or at `warn` on `error`, but no test checks `line["level"]`. A regression to a single level would go unnoticed. Assert `info` in the 200 and 404 tests and `warn` in the 500, malformed and refused tests.

- **minor** (`node/tests/test_sponsorblock.py:122`) The midpoint test duplicates an existing test and does not fail without this change

  `test_midpoint_rule_edges` covers the same edges as `test_segments_drop_cue_by_midpoint` in `node/tests/test_cleaning.py:80`. The behaviour was already in `clean_cues` before this change, as decisions.md line 18 says. It is harmless, but it adds no coverage of its own. It could be removed, or replaced with a test that combines `fetch_segments` output with `clean_cues`.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:13`) The 10 s timeout is not tested

  `TIMEOUT_S = 10` is passed to `urlopen`, but no test checks that the timeout is applied or that a timeout maps to `error` with status 0. A test could set the timeout low (by monkeypatching `TIMEOUT_S`) against a handler that sleeps.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The client builds the URL as spec 5.3 says (`/api/skipSegments`, `videoID`, URL-encoded categories list), with a 10 s timeout. It maps 200, 404 and other statuses to `ok`, `none` and `error`, and logs `sponsorblock.call` with `status` (0 on network error), `segments` and `duration_ms`. `sponsor_ratio` is computed correctly: union of the segments, clipped to the duration, 3 decimals. The cue cut already existed in `cleaning.py:61-62`. Nothing out of scope was added. However, network errors raised as `http.client.HTTPException` (for example `IncompleteRead` or `BadStatusLine`) escape the function, so spec 5.3's rule (error state, result produced normally, call logged) is not fully met.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The client builds the URL as spec 5.3 says (`/api/skipSegments`, `videoID`, URL-encoded categories list), with a 10 s timeout. It maps 200, 404 and other statuses to `ok`, `none` and `error`, and logs `sponsorblock.call` with `status` (0 on network error), `segments` and `duration_ms`. `sponsor_ratio` is computed correctly: union of the segments, clipped to the duration, 3 decimals. The cue cut already existed in `cleaning.py:61-62`. Nothing out of scope was added. However, network errors raised as `http.client.HTTPException` (for example `IncompleteRead` or `BadStatusLine`) escape the function, so spec 5.3's rule (error state, result produced normally, call logged) is not fully met.

- met: The change is covered by tests that fail without it.

  `node/tests/test_sponsorblock.py` runs against a local `HTTPServer` and covers: 200 with segments (path, query, categories, log fields checked), 404, 500, malformed 200, and connection refused. It also covers the ratio with overlapping and contained segments, a segment past the end, and a negative start. The module is new, so every one of these tests fails without it. Not covered: the log level and the timeout. The midpoint test duplicates existing coverage.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  `docs/decisions.md` lines 17-18 record: the function signature and return shape, a malformed 200 counted as `error`, the log levels and attrs, the ratio returning 0 for a non-positive duration, segments that are empty once clipped being ignored, and the step 2 cut already being in `clean_cues`.

## Proposed learnings (not decided)

- urllib's `urlopen` and `response.read()` can raise `http.client.HTTPException` subclasses (`IncompleteRead`, `BadStatusLine`, `LineTooLong`) that are not `OSError`. A client that must turn every network error into a state has to catch those too.
- When a decision fixes the log level, add a test that asserts it.
- When a ticket's step is already implemented by an earlier ticket, say so in the decisions and don't add duplicate tests that pass without the change.
