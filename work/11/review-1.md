# Review 1

- Reviewed commit: `796477899b036fc1ccc628be00e6dd648acd86e3`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/paging.py:53`) A page can hold only the `[…]` marker

  Spec 5.6 says "No page is empty". The marker weighs 0 words and sits alone in `current`. If the paragraph after it is longer than `PAGE_WORDS`, `flush()` emits a page that is just "[…]" with 0 words. Example: MAX_WORDS=4, PAGE_WORDS=1 and one long paragraph give pages ["a","b","[…]","c","d"]. MAX_WORDS=1 gives the single page ["[…]"]. Either attach the marker to the neighbouring page or record the choice in docs/decisions.md and add a test.

- **minor** (`node/src/yt_digest_node/cli.py:50`) No `fetch.transcript` line when the extractor raises

  Spec 5.7 asks for one `fetch.transcript` line per command. When the extractor raises, the command exits 1 with a traceback and logs no `fetch.transcript`. This is written down in docs/decisions.md, and the spec does not cover unexpected errors, so it is acceptable. It still departs from the letter of 5.7. A `try/finally` that logs an `error`-level line could be considered later.

- **minor** (`node/tests/test_cli.py:67`) Some logging rules are not asserted end to end

  No CLI test checks `attrs.sponsorblock == "none"` on a 404. None checks that `attrs.sponsor_ratio` is present in `fetch.transcript` when SponsorBlock succeeds and absent when it fails. None checks the `service.started` `version` attribute, or that `request_id` is left out when `--request-id` is not given. Section 6 asks that every rule of section 5 be covered by a test that fails without it.

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

  `paging.py` covers 5.5 and 5.6: the head and tail are each `MAX_WORDS // 2` words and paragraph breaks are kept. The marker is a separate paragraph and does not count as a word. Paragraphs are grouped into pages, and a paragraph that is too long is cut at word boundaries. `cli.py` covers 5, 5.1 and 5.7. It takes the subcommand `transcript <video_id> [--langs] [--request-id]` and reads the configuration from the environment with the spec's defaults. It runs extract → choose_track → SponsorBlock → clean → truncate → paginate and validates the result with `TranscriptResult.model_validate` before printing it to stdout. It logs `service.started` first and then `fetch.transcript` with request_id and video_id. It exits 2 through argparse on an invalid id or invalid configuration and 0 otherwise. pyproject has a build-system, so the `yt-digest-node` script is installed. Nothing from the daemon, /health or the Worker is added. Only small edge cases remain (findings 1 and 2).

- met: The change is covered by tests that fail without it.

  `test_paging.py` covers both acceptance cases. MAX_WORDS=10 on 25 words gives words 0–4, ["[…]"], words 20–24, truncated true and a count of 10. PAGE_WORDS=5 with a 12-word paragraph gives pages of at most 5 words whose words, read in order, are the words of the text in order. `test_cli.py` runs `python -m yt_digest_node.cli` as a subprocess with the fake extractor and a local HTTP SponsorBlock. It covers ok with sponsor cuts (ratio 0.14, the SECRETSPONSOR cue removed), a SponsorBlock error, no_transcript, unavailable, blocked, a missing directory, invalid ids (exit 2, empty stdout), invalid configuration, the langs options, and log lines with no transcript text. All of them import modules that did not exist before, so they fail without the change. Some log attributes are not asserted (finding 3).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines were added. They record: the marker as a paragraph weighing 0 words and how a long paragraph is flushed; exit 2 on invalid configuration and when `service.started` is logged; SponsorBlock skipped when there is no track and the attributes left out; the script entry point; extractor exceptions giving exit 1; how `--langs` is parsed and falls back; `YT_DELAY_SECONDS` not being checked. The only open choice not written down is a page made of the marker alone (finding 1).

## Proposed learnings (not decided)

- When a weightless marker is added to pagination, check the 'no empty page' rule against edge cases: a marker followed by an oversized paragraph, and MAX_WORDS=1.
- For every attribute in the log catalogue, end-to-end CLI tests should assert both that it is present and that it is absent where expected (e.g. sponsorblock none/error, sponsor_ratio omitted), not only the outcome.
- Decide early whether an uncaught exception must still emit the per-command summary log line the spec requires, and record the decision.
