# Review 0

- Reviewed commit: `2330601d76682f9e683225e0e9212b55c428d063`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/extractors.py:137`) The yt-dlp extractor downloads every track from YouTube without the required delay

  Spec 5.1 says `YT_DELAY_SECONDS` is the random delay before each YouTube request. `extract` sleeps once, before `extract_info`. It then calls `self.download(vtt["url"])` for every entry in `subtitles` and `automatic_captions` with no delay at all. These are YouTube timedtext requests. On a real YouTube video, `automatic_captions` lists every auto-translated language, about 150 entries. So one call sends about 150 back-to-back requests to YouTube. That breaks the delay rule. It is also very likely to hit HTTP 429. `urllib` raises that as an `HTTPError`, which is neither mapped to `blocked` nor caught, so the command would crash instead of returning a result. Fix with the simplest option: apply the delay before each download and fetch only the tracks that can be chosen. For example, pass the language order to the extractor or load VTT text lazily, and record that choice in docs/decisions.md. Map download errors such as 429/403 too. No test covers this: the stubbed test has one manual and one auto track and does not check how many sleeps happen per download.

- **minor** (`node/src/yt_digest_node/extractors.py:20`) The 'unavailable' markers go beyond what the spec lists

  The spec maps private, age-restricted and removed to `unavailable`. The code also maps 'video unavailable', 'this video is not available' and the terminated-account message. The 'video unavailable' marker also matches YouTube's rate-limit message 'Video unavailable. This content isn't available, try again later.', which is really a block, so it would be reported as `unavailable`. Matching on substrings is fragile; decisions.md records it, but these extra markers should be narrowed.

- **minor** (`node/tests/test_extractors.py:24`) Tests build their fixtures in tmp_path, not under node/tests/fixtures/

  Spec section 6 says fixtures go under `node/tests/fixtures/`. The fake extractor tests write fixture directories into `tmp_path` at run time. Also, the acceptance case 'fr.auto.vtt + en.manual.vtt with fr,en picks English manual' is only tested on `choose_track` with in-memory tracks, not end to end through a fake fixture directory.

- **minor** (`node/src/yt_digest_node/extractors.py:166`) Some open choices are not recorded in decisions.md

  These are not written down: `choose_track` returns `None` (the `no_transcript` mapping is left to the caller); a missing `meta.json` counts as an empty object (status ok, duration 0); `.vtt` files whose names don't match `<lang>.<manual|auto>.vtt` are silently skipped; an invalid `YT_DELAY_SECONDS` raises `ValueError`.

- **minor** (`node/tests/test_extractors.py:157`) Some mapping and delay branches are untested

  No test covers the ASCII-apostrophe bot marker, the 'has been removed' marker on its own, or the fact that the fake extractor never sleeps. Nothing checks that `quiet`/`no_warnings` are set, and the cookie test only checks two keys.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The interface, the fake extractor, the options, the error mapping and the track choice match spec 5.2. But the delay is applied only once per `extract`, while spec 5.1 requires it before each YouTube request, and every subtitle track (about 150 auto-translated ones) is downloaded with no delay (extractors.py:117-142). The unavailable markers also cover more cases than the spec lists.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  decisions.md lines 19-21 record the interface, the error mapping, the urllib download and the delay format. They do not record: `choose_track` returning None instead of `no_transcript`, a missing meta.json counting as {}, misnamed .vtt files being skipped, and the handling of an invalid `YT_DELAY_SECONDS`.

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

  The interface, the fake extractor, the options, the error mapping and the track choice match spec 5.2. But the delay is applied only once per `extract`, while spec 5.1 requires it before each YouTube request, and every subtitle track (about 150 auto-translated ones) is downloaded with no delay (extractors.py:117-142). The unavailable markers also cover more cases than the spec lists.

- met: The change is covered by tests that fail without it.

  test_extractors.py covers the missing directory, the blocked and unavailable meta status, track reading, the manual-before-auto choice, no match, the stubbed options (no cookies), the private/age/removed/bot mapping and the re-raise of unknown errors. The delay per download and the multi-track download behaviour are not tested.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  decisions.md lines 19-21 record the interface, the error mapping, the urllib download and the delay format. They do not record: `choose_track` returning None instead of `no_transcript`, a missing meta.json counting as {}, misnamed .vtt files being skipped, and the handling of an invalid `YT_DELAY_SECONDS`.

## Proposed learnings (not decided)

- The spec requires a delay before each YouTube request, so check every outbound call (subtitle downloads included), not just the metadata call.
- yt-dlp's `automatic_captions` lists every auto-translated language (about 150 entries); downloading all of them in a loop is a rate-limit risk.
- Stub tests with one track per kind can hide behaviour that scales with the number of tracks; assert the number of requests and sleeps.
