# Review 1

- Reviewed commit: `7a36d222a1371ca13f39f21affbd427c3e84c69e`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/cleaning.py:42`) Whitespace-only lines are treated as block separators

  Blocks are split on `\n[ \t]*\n`, so a line holding only spaces ends the cue. Under WebVTT, only an empty line ends a cue. YouTube auto tracks put a ' ' line just before the real blank line, so the fixtures are unaffected. But any text after a whitespace-only line inside a cue would form a block with no timing line and be dropped silently. This is a parsing choice the spec leaves open, and it is not recorded in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/cleaning.py:10`) Timing regex accepts more than WebVTT timestamps

  `[.,]` accepts a comma as the decimal separator, as in SRT, and `\d{1,2}` accepts one-digit minutes. This leniency is harmless, but it goes beyond what the spec asks, and neither the decisions log nor a test mentions it.

- **minor** (`node/tests/test_cleaning.py:12`) Removing the WEBVTT header is not proven by a test

  The header block has no `-->` line, so it would be skipped even without the `WEBVTT` entry in `_IGNORED_BLOCKS`. The NOTE, STYLE and REGION rules are covered properly by test_note_style_region_blocks_are_ignored. A header followed directly by a timing line, with no blank line between them, is not tested.

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

  `parse_vtt` covers step 1: it ignores the header, NOTE, STYLE and REGION blocks and cue settings. `clean_cues` covers steps 2 to 5. Step 2 uses the midpoint with start inclusive and end exclusive, and does nothing on an empty list. Step 3 removes tags, then decodes entities, then removes brackets, collapses whitespace and trims, which is the spec's order. Step 4 drops empty lines and consecutive duplicates. Step 5 starts a new paragraph on a gap of 2000 ms or more between kept cues. The three fixtures are under node/tests/fixtures/vtt/. Nothing outside the ticket's scope was added; SponsorBlock fetching, truncation, pages and the command are all absent. The only extras are small parser leniencies (BOM, CRLF, comma decimals).

- met: The change is covered by tests that fail without it.

  cleaning.py and test_cleaning.py are both new, so every test fails without the change. Each rule is checked by an exact assertion: rolling duplicates (auto fixture), `[Musique]` and `[Applause]` removed and `&amp;`, `&lt;`, `&gt;` and `&nbsp;` decoded (annotations fixture), a 2.0 s gap splitting and a 1.9 s gap not (manual fixture plus a synthetic test), the segment midpoint boundaries, and NOTE, STYLE and REGION blocks ignored. Ariane's replayed checks are green: lint, contracts, test-node and test-worker.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: the segment and return types, the definition of a kept cue and the millisecond comparison, duplicates checked across cues, and how a cue block is recognised (including BOM and CRLF). Two smaller leniencies are not recorded: whitespace-only lines ending a block, and comma decimals. Both are reported as minor findings.

## Proposed learnings (not decided)

- When a test is meant to prove that a block is ignored, give the block a `-->` line, so that it would be parsed as a cue if the rule were missing.
- WebVTT ends a cue only at an empty line. A split on whitespace-only lines is a choice and should go in docs/decisions.md.
- Comparing gaps in whole milliseconds avoids float errors at the 1.9 s / 2.0 s boundary; it is worth reusing for any time threshold.
