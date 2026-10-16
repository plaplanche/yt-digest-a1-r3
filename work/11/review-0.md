# Review 0

- Reviewed commit: `c003dd6fa5de7ddcda49728a978ca6398938cf09`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/cli.py:104`) TRANSCRIPT_LANGS (spec 5.1) is never tested

  The ticket puts "configuration from the environment (section 5.1)" in scope, and spec section 6 says every rule of section 5 must be covered by a test that fails without it. Nothing in node/tests sets TRANSCRIPT_LANGS: a grep finds no test that uses it. If you replaced the fallback `env.get("TRANSCRIPT_LANGS") or "fr,en"` with a hard-coded "fr,en", every test would still pass. Fix: add an end-to-end test that, with no --langs, sets TRANSCRIPT_LANGS=en (expect no_transcript for sponsored01) or TRANSCRIPT_LANGS=de (expect ok/de for notrack0001). Also check that --langs wins over TRANSCRIPT_LANGS.

- **minor** (`node/tests/test_cli.py:41`) The subprocess inherits the developer's environment

  `run` starts from `**os.environ`. If TRANSCRIPT_LANGS, MAX_WORDS or PAGE_WORDS is set in the shell or on the CI runner, the expected outputs change (for example, test_ok_with_sponsor_cuts expects 'fr'). Remove these variables, or build a minimal environment.

- **minor** (`node/tests/test_cli.py:151`) Only one of the documented exit-2 configuration cases is tested

  docs/decisions.md says the command exits 2 when MAX_WORDS or PAGE_WORDS is below 1 or not an integer, and when FAKE_YTDLP_DIR is missing. Only MAX_WORDS=abc is tested. If the `< 1` check were removed, PAGE_WORDS=0 would crash inside paginate (`range` with step 0) with a traceback, and no test would notice.

- **minor** (`node/src/yt_digest_node/cli.py:50`) Extractor exceptions crash the command without a fetch.transcript line, and this is not written down

  An earlier decision says the yt-dlp extractor re-raises errors it cannot map. run_transcript does not catch them, so the command exits 1 with a plain Python traceback on stderr: there is no fetch.transcript line (spec 5.7 asks for one line per command), and the traceback is not a JSON log line. The spec does not cover this case. Per the project rule, the choice should be recorded in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/cli.py:102`) Undocumented choices in parsing the language list

  `--langs ""` falls back to TRANSCRIPT_LANGS or fr,en. Entries are stripped and empty ones dropped, so `--langs ,` gives an empty list and always no_transcript instead of exit 2. An invalid YT_DELAY_SECONDS also leads to exit 2, but the new decision line lists only MAX_WORDS, PAGE_WORDS and FAKE_YTDLP_DIR. These are open choices and should go into docs/decisions.md.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  test_paging.py covers the ticket's unit criteria: 25 words with MAX_WORDS=10, PAGE_WORDS=5 with a 12-word paragraph, and order kept. test_cli.py runs the command as a subprocess with the fake extractor and a local HTTP SponsorBlock. It covers ok with sponsor cuts, no_transcript, unavailable, blocked, an invalid id (exit 2) and logs without transcript text. But TRANSCRIPT_LANGS, which is in scope through 5.1, has no test at all, and PAGE_WORDS<1 and a missing FAKE_YTDLP_DIR are not tested either.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: marker weight and how long paragraphs are cut, exit 2 on configuration errors, attributes left out of fetch.transcript and SponsorBlock called only when a track is chosen, and the entry point. Some choices are not recorded: what happens when the extractor raises an exception (exit 1, traceback, no fetch.transcript line), the fallback for empty or blank --langs entries, and exit 2 on an invalid YT_DELAY_SECONDS.

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

  paging.py follows spec 5.5: head and tail of MAX_WORDS//2 words, inner paragraph breaks kept, a `[…]` paragraph that is not counted as a word. It follows 5.6: whole paragraphs grouped into pages, long paragraphs cut at word boundaries, no empty page. cli.py implements `transcript <video_id> [--langs] [--request-id]` with the 5.1 environment variables, prints a result validated with TranscriptResult.model_validate on stdout, logs service.started then fetch.transcript on stderr, and exits 0 for every status and 2 through argparse. The project.scripts entry provides `yt-digest-node`. There is no daemon, /health or Worker code.

- **not met**: The change is covered by tests that fail without it.

  test_paging.py covers the ticket's unit criteria: 25 words with MAX_WORDS=10, PAGE_WORDS=5 with a 12-word paragraph, and order kept. test_cli.py runs the command as a subprocess with the fake extractor and a local HTTP SponsorBlock. It covers ok with sponsor cuts, no_transcript, unavailable, blocked, an invalid id (exit 2) and logs without transcript text. But TRANSCRIPT_LANGS, which is in scope through 5.1, has no test at all, and PAGE_WORDS<1 and a missing FAKE_YTDLP_DIR are not tested either.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: marker weight and how long paragraphs are cut, exit 2 on configuration errors, attributes left out of fetch.transcript and SponsorBlock called only when a track is chosen, and the entry point. Some choices are not recorded: what happens when the extractor raises an exception (exit 1, traceback, no fetch.transcript line), the fallback for empty or blank --langs entries, and exit 2 on an invalid YT_DELAY_SECONDS.

## Proposed learnings (not decided)

- For each environment variable in a spec configuration table, have at least one end-to-end test that sets it to a non-default value; otherwise a hard-coded default goes unnoticed.
- End-to-end tests that spread os.environ into the subprocess should remove the variables the app reads, to keep them hermetic.
- When a pipeline command can raise through an extractor, decide and document whether it still logs the per-command event, and with what exit code.
