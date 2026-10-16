# Review 1

- Reviewed commit: `22813c3ffc97dfb93a09308ebe93a0cf28c24f1a`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`docs/decisions.md:19`) The decision log contradicts itself and the code

  Six lines were added, and the later ones overturn the earlier ones without removing them. Line 19 gives the interface as `extract(video_id)`, but line 22 and the code use `extract(video_id, langs)`. Line 20 says the word "unavailable" maps to `unavailable`, but line 23 says only the spec's markers count and the rest is raised; the code (UNAVAILABLE_MARKERS) and the test `test_ytdlp_rate_limit_message_is_not_unavailable` follow line 23. Line 21 says the yt-dlp extractor downloads every manual and automatic track, but line 22 says only the first choosable track is downloaded, which is what the code does. Someone reading docs/decisions.md cannot tell which choice is in force, and three of the lines are false. Remove or rewrite lines 19–21 so that each choice appears once and matches the code.

- **minor** (`node/src/yt_digest_node/extractors.py:139`) Exact language-code matching is an open choice that is not written down

  Both `choose_track` and the yt-dlp loop match `lang` against yt-dlp's subtitle keys exactly. yt-dlp often uses keys like `en-US`, `fr-FR` or `en-orig`, so with `--langs fr,en` a video whose only manual track is `en-US` falls through to auto captions or ends as `no_transcript`. The spec leaves the matching rule open. Whatever rule is kept should be recorded in docs/decisions.md, as the project instructions require.

- **minor** (`node/src/yt_digest_node/extractors.py:20`) Some 'removed' videos are not mapped to unavailable

  The only removal marker is `has been removed`. yt-dlp's message for videos whose channel was terminated ("This video is no longer available because the YouTube account associated with this video has been terminated") does not contain it. That error is raised, and the command (not built yet) may then crash instead of returning `unavailable`. Consider adding the terminated-account text as a removal marker and testing it.

- **minor** (`node/src/yt_digest_node/extractors.py:134`) The yt-dlp extractor returns at most one track, not the video's tracks

  Spec 5.2 says an extractor returns the video's subtitle tracks. The yt-dlp extractor applies the choice itself and returns only the chosen track, so the choice logic now exists twice: here and in `choose_track`. This is documented (line 22) and limits requests, which is reasonable. The duplication is still a drift risk; a shared test pinning the two to the same order would help.

- **minor** (`node/tests/test_extractors.py:59`) The 'fake never sleeps' test cannot fail

  FakeExtractor has no sleep path at all, so patching `time.sleep` proves nothing. The spec rule (delay forced to 0 with the fake extractor) would be better covered through `make_extractor`, for example by asserting that `YT_DELAY_SECONDS` is ignored or never applied when `FETCHER_FAKE_YTDLP=1`.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Choices are recorded in docs/decisions.md lines 19–24, but lines 19–21 contradict lines 22–23 and the code (extract signature, the 'unavailable' marker, which tracks are downloaded). The exact language-code matching rule is not recorded.

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

  These are all implemented in node/src/yt_digest_node/extractors.py: the extractor protocol; the fake extractor reading `$FAKE_YTDLP_DIR/<id>/` (missing dir → unavailable, meta status returned as is, `<lang>.<kind>.vtt` tracks); the yt-dlp extractor with the four spec options and no cookies; the `YT_DELAY_SECONDS` delay before each request, with none for the fake; error mapping for private, age-restricted, removed and bot check; and `choose_track`. The extra 403/429 → blocked mapping and the single-track download are documented design choices within scope. Truncation, pages and the command are untouched.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py covers every acceptance criterion against a module that is new in this change: missing dir → unavailable, meta blocked → blocked, fr.auto + en.manual with fr,en → en manual, de.manual only → None (no_transcript), the stubbed yt-dlp options (including no cookie key), private → unavailable and bot check → blocked. The 'never sleeps' test is vacuous, which is a minor finding. Ariane's replay shows test-node green.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Choices are recorded in docs/decisions.md lines 19–24, but lines 19–21 contradict lines 22–23 and the code (extract signature, the 'unavailable' marker, which tracks are downloaded). The exact language-code matching rule is not recorded.

## Proposed learnings (not decided)

- When a decision changes during a ticket, rewrite or delete the earlier line in docs/decisions.md instead of appending a new one that contradicts it.
- For the yt-dlp extractor, record how language codes are matched (exact vs. prefix, e.g. `en` vs `en-US`/`en-orig`), because yt-dlp keys rarely match bare language codes.
- A test that patches a function the code under test never calls cannot fail; test spec rules through the factory that applies them (e.g. `make_extractor` for the forced-zero delay).
