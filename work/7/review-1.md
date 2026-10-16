# Review 1

- Reviewed commit: `6f467e2a98058909de64d62ae788c16e776492ff`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/sponsorblock.py:47`) The 10 s timeout applies to each socket operation, not to the whole call

  `urlopen(url, timeout=TIMEOUT_S)` sets a timeout on each blocking socket operation. A server that sends one byte every few seconds can therefore keep the call running well past 10 s. Spec 5.3 only says "timeout 10 s". Reading that as "per socket operation" is an open choice, and docs/decisions.md doesn't record it. Either write down that reading or enforce a total deadline.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:28`) Non-finite segment bounds are accepted

  `json.loads` accepts `NaN`/`Infinity`, and `float()` passes them through. A body such as `[{"segment":[NaN,NaN]}]` gives state `ok`. In `sponsor_ratio`, `max(0.0, nan)` returns 0.0 and `min(duration, nan)` returns duration, so that segment clips to [0, duration] and the ratio becomes 1.0. Rejecting non-finite values, for example by treating the body as malformed, would be safer. The input is unlikely, so this is minor.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:50`) HTTPError response is never closed

  The `HTTPError` caught for 404 and 500 wraps an open response, and the code never closes it. This can trigger a ResourceWarning or leak a socket until garbage collection. Calling `error.close()` would fix it.

- **minor** (`node/tests/test_sponsorblock.py:136`) No test pins the 10 s timeout value

  The timeout test monkeypatches `TIMEOUT_S` to 0.2. If someone changed the constant away from the spec's 10 s, no test would fail. A one-line assertion that `TIMEOUT_S == 10` would pin it.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The client builds `{base}/api/skipSegments?videoID=..&categories=["sponsor","selfpromo","interaction"]` with the list URL-encoded (urlencode) and a 10 s timeout. It maps 200 to `ok` with the segments, 404 to `none`, and any other status or a network error to `error` with status 0. It logs `sponsorblock.call` with the `status`, `segments` and `duration_ms` attrs listed in the spec's log catalogue. `sponsor_ratio` computes the union, clips it to [0, duration], rounds to 3 decimals and returns 0 without segments. The midpoint cut already existed in `cleaning._in_segment` (start <= mid < end). The change adds no extractor, truncation, pages or command code.

- met: The change is covered by tests that fail without it.

  The new file node/tests/test_sponsorblock.py imports `fetch_segments`/`sponsor_ratio`, which don't exist on the base commit, so these tests fail there. It covers 200, 404, 500, connection refused, malformed 200, incomplete read and timeout against a local HTTPServer, checking state, segments and the log line each time. It also covers the ratio with overlapping segments and with segments that start before 0 or run past the end. The midpoint edges (start inclusive, end exclusive) were already tested in test_cleaning.py::test_segments_drop_cue_by_midpoint, and an integration test cuts cues with the fetched segments.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two new dated lines cover the function signature and return types, a malformed 200 counting as `error`, the log levels (info, or warn on error), the duration <= 0 behaviour, empty clipped segments, and the note that step 2 was already implemented. One choice is missing: the timeout is applied to each socket operation, not to the whole call (reported as a minor finding).

## Proposed learnings (not decided)

- urllib's `timeout` applies to each socket operation, not to the whole request; when a spec gives a timeout, record which reading was chosen.
- Python's json module accepts NaN/Infinity by default, and min/max with NaN depend on argument order; validate numbers parsed from external JSON as finite.
- When a ticket repeats acceptance criteria for code that already exists (here the midpoint rule), check the existing tests before asking for new ones.
