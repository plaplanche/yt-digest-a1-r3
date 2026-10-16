# Review 0

- Reviewed commit: `2ffc118a2e66e905735473021c41ad29c677315d`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/tests/test_cleaning.py:56`) test_empty_cue_does_not_bridge_gap does not test what it claims

  Step 5 measures the gap from the previous *kept* cue, and docs/decisions.md line 14 defines a kept cue as one that still has a line after steps 3–4. The test meant to cover that rule uses annotations.vtt, where the empty `[Applause]` cue at 9.9 s is the last cue. Nothing follows it, so there is no gap for it to bridge. The `[Musique]` cue at 0–2 s is followed by a cue starting at 2.0 s, so the gap there is 0. If an implementation updated `previous_end` for every cue, empty ones included, it would still return one paragraph, and every other test would still pass (manual.vtt has no empty cues, and the empty cues in auto.vtt are contiguous). So the kept-cue rule is not covered by a test that fails without it, which spec §6 requires, and the test name is misleading. Fix: add a case where an empty cue sits between two kept cues that are ≥2.0 s apart and less than 2.0 s from the empty cue, e.g. Cue(0,1,['a']), Cue(2,2.5,['[Music]']), Cue(3.5,4,['b']), and expect ['a','b'].

- **minor** (`node/tests/test_cleaning.py:51`) Annotations test checks only prefix and suffix

  The test does not compare the full paragraph, so the text between `4 and` and `more` (the `&nbsp;` decoding and its whitespace collapse) is never checked. A full equality assertion, e.g. 'Tom & Jerry are here 5 < 6 > 4 and more spaces bold under', would cover it.

- **minor** (`node/src/yt_digest_node/cleaning.py:34`) Explicit NOTE/STYLE/REGION skipping is not exercised

  Blocks without a `-->` line are already dropped by the timing check, and WebVTT forbids `-->` inside NOTE/STYLE/REGION blocks. So `_is_ignored` changes nothing that any test can see, and the tests would pass without it. This is harmless, but it is unexercised code.

- **minor** (`node/src/yt_digest_node/cleaning.py:42`) Literal invisible BOM character in source; BOM handling untested

  `text.lstrip("﻿")` is written with a literal U+FEFF character, which cannot be seen in editors or diffs; use the `﻿` escape instead. The BOM acceptance recorded in docs/decisions.md line 16 also has no test.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  Most rules are covered: rolling duplicates, [Musique] and [Applause] removed, &amp; decoded, the 2.0 s and 1.9 s gaps (manual.vtt and a synthetic test), segment midpoint bounds, and duplicates across cues. But test_empty_cue_does_not_bridge_gap would pass even if gaps were measured from empty cues, so the step 5 'kept cue' rule has no test that fails without it. The &nbsp; whitespace handling and the BOM are not checked either.

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

  cleaning.py adds `parse_vtt`, which ignores the header, NOTE, STYLE and REGION blocks and cue settings, and accepts cue identifiers and hour timestamps. It also adds `clean_cues`, which applies steps 2–5 of §5.4: midpoint drop with start inclusive and end exclusive, tag removal, entity decoding, bracket removal, whitespace collapse and trim, empty and duplicate line drop, and a paragraph gap of 2.0 s or more. The three required fixtures are under node/tests/fixtures/vtt/. There are no extractors, no SponsorBlock fetching, no truncation, no pages and no command.

- **not met**: The change is covered by tests that fail without it.

  Most rules are covered: rolling duplicates, [Musique] and [Applause] removed, &amp; decoded, the 2.0 s and 1.9 s gaps (manual.vtt and a synthetic test), segment midpoint bounds, and duplicates across cues. But test_empty_cue_does_not_bridge_gap would pass even if gaps were measured from empty cues, so the step 5 'kept cue' rule has no test that fails without it. The &nbsp; whitespace handling and the BOM are not checked either.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 13–16 record: the segment input type and returning a list of paragraphs, the kept-cue definition with millisecond comparison, step 4 duplicates across cues, and cue block recognition with BOM and CRLF accepted. Each is one dated line.

## Proposed learnings (not decided)

- A test that claims a rule should be checked against a broken implementation: build the fixture so that a wrong implementation gives a different output (e.g. an empty cue must sit between two kept cues to test gap bridging).
- Prefer full equality assertions over prefix and suffix checks on cleaned text; partial checks leave the middle of the string (entity and whitespace handling) unverified.
- Write invisible characters such as the BOM as escapes (﻿) in source code.
