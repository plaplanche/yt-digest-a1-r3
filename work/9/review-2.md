# Review 2

- Reviewed commit: `ceea2f01ef07749745b83b763eed9f3a749ea6ed`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`docs/decisions.md:24`) Decisions contradict each other and the code on the `unavailable` markers

  Line 24 says the `unavailable` markers are "only the spec's: private, age-restricted (...) and removed". Line 20 and `UNAVAILABLE_MARKERS` (extractors.py:25) also map "account associated with this video has been terminated" to `unavailable`, and a test covers it. One of the two lines should change: either line 24 lists the terminated-account marker as a reading of "removed", or the marker is dropped.

- **minor** (`node/src/yt_digest_node/extractors.py:136`) The yt-dlp extractor returns only the chosen track, not "its subtitle tracks"

  Spec 5.2 says an extractor returns, for a video id, the duration and its subtitle tracks, and the choice is made afterwards. Here the extractor takes `langs`, applies the choice itself and returns at most one track, while the fake extractor returns every track. `test_ytdlp_and_choose_track_agree` checks that the two paths agree. Decision line 23 records this, and it keeps the number of requests low, but the two extractors now have different contracts. The command (a later ticket) has to call `choose_track` on both outputs for this to hold.

- **minor** (`node/src/yt_digest_node/extractors.py:80`) Subtitles are fetched with a bare urllib call, so the spec's yt-dlp subtitle options do nothing

  The code passes `writesubtitles`, `writeautomaticsub` and `subtitlesformat` but calls `extract_info(download=False)`, then picks URLs from `subtitles` and `automatic_captions` and downloads them with `urllib.request.urlopen`. That skips yt-dlp's headers and networking (`ydl.urlopen`). The spec options are present and tested, so the letter of the spec is met. The behavior against real YouTube is untested, and no decision line explains why urllib is used instead of yt-dlp's own fetch.

- **minor** (`node/src/yt_digest_node/extractors.py:119`) Rate limiting is mapped to `blocked` on subtitle downloads but raised during `extract_info`

  An HTTP 403 or 429 on the subtitle download returns `blocked`. yt-dlp's own `HTTP Error 429: Too Many Requests` during `extract_info` matches no marker and is raised. Decision line 24 documents this, but the same YouTube condition gives two different outcomes depending on which request hits it.

- **minor** (`node/src/yt_digest_node/extractors.py:106`) Options outside the spec (`quiet`, `no_warnings`) are not recorded

  `options()` adds `quiet=True` and `no_warnings=True` to the spec's option set. These are harmless and keep stdout clean for the future command, but they are a choice beyond spec 5.2 that is not written in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/extractors.py:182`) `choose_track` returns None, not `no_transcript`

  The ticket says "none gives `no_transcript`". The function returns `None`, and decision line 25 leaves the mapping to the caller, which is the command (out of scope). This is acceptable, but no code in this change produces `no_transcript` yet, so the follow-up ticket must do the mapping and test it.

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

  extractors.py adds the result type (`Extraction | "unavailable" | "blocked"`). `FakeExtractor` reads `$FAKE_YTDLP_DIR/<id>/`: a missing directory gives `unavailable`, `meta.json` status is returned as is, and `<lang>.<manual|auto>.vtt` files become tracks. `YtDlpExtractor` uses the spec options, no cookies, the error mapping, and a random delay before each request. `make_extractor` switches on `FETCHER_FAKE_YTDLP=1` and never delays the fake. `choose_track` tries manual then auto in language order. The 403/429 mapping, the terminated-account marker and the single-track download go a little beyond the spec, but each is a documented elaboration of the error mapping or the request delay, not a new feature. Truncation, pages and the command are not touched.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py imports the new module, so every test fails without it. It covers each acceptance criterion: missing directory → unavailable; `blocked` meta → blocked; `mixed` fixture (fr.auto + en.manual, langs fr,en) → en manual; `german` fixture → None (no_transcript); stub options, including no cookie key; private → unavailable; bot check (both apostrophes) → blocked. It also covers age/removed/terminated, unknown errors raised, 403/429 → blocked, other HTTP errors raised, the delay count and range with an injected sleep, `parse_delay`, `make_extractor`, and the fake ignoring `YT_DELAY_SECONDS`. Ariane's replayed test-node check passed.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines (19–25) record: the interface shape, the error-matching method, the lazy yt-dlp dependency, the `YT_DELAY_SECONDS` format, a missing duration or meta.json, exact language matching, the single-track download and its delay, 403/429, None for no match, misnamed .vtt files and an invalid delay. Two gaps: `quiet`/`no_warnings` and the urllib subtitle download are not recorded, and line 24 contradicts line 20 on the terminated-account marker (all minor findings).

## Proposed learnings (not decided)

- When decisions.md has several lines about the same mapping, check that they agree with each other and with the constants in the code; a later line that says "only the spec's" can silently contradict an earlier one.
- If an extractor applies the track choice itself to save requests, test that it agrees with the standalone choice function, as this change does, and make sure the follow-up command calls the choice function on every extractor's output.
- Map rate limiting the same way wherever it can appear (yt-dlp's `extract_info` errors as well as direct subtitle downloads), or document why the two differ.
