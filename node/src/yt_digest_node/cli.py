"""The `yt-digest-node` command and the transcript pipeline (spec 5, 5.1, 5.7)."""

import argparse
import os
import re
import sys
import time
from collections.abc import Sequence
from importlib.metadata import version
from typing import Any

from yt_digest_node.cleaning import clean_cues, parse_vtt
from yt_digest_node.contracts.transcript_result import TranscriptResult
from yt_digest_node.extractors import Extractor, choose_track, make_extractor
from yt_digest_node.log import emit
from yt_digest_node.paging import paginate, truncate
from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _empty(video_id: str, status: str) -> dict[str, Any]:
    return {
        "video_id": video_id,
        "status": status,
        "lang": None,
        "source": None,
        "word_count": 0,
        "truncated": False,
        "sponsor_ratio": None,
        "pages": [],
    }


def run_transcript(
    video_id: str,
    langs: list[str],
    env: dict[str, str],
    extractor: Extractor,
    request_id: str | None = None,
) -> TranscriptResult:
    """Run the whole pipeline and log `fetch.transcript`."""
    max_words = int(env.get("MAX_WORDS", "60000"))
    page_words = int(env.get("PAGE_WORDS", "12000"))
    base_url = env.get("SPONSORBLOCK_URL", "https://sponsor.ajay.app")
    started = time.monotonic()
    result = _empty(video_id, "no_transcript")
    attrs: dict[str, Any] = {}

    extraction = extractor.extract(video_id, langs)
    if isinstance(extraction, str):
        result["status"] = extraction
    elif (track := choose_track(extraction.tracks, langs)) is not None:
        blocked = fetch_segments(base_url, video_id, request_id)
        paragraphs = clean_cues(parse_vtt(track.vtt), blocked.segments)
        paragraphs, truncated = truncate(paragraphs, max_words)
        pages, words = paginate(paragraphs, page_words)
        ratio = (
            None
            if blocked.state == "error"
            else sponsor_ratio(blocked.segments, extraction.duration)
        )
        result.update(
            status="ok",
            lang=track.lang,
            source=track.kind,
            word_count=words,
            truncated=truncated,
            sponsor_ratio=ratio,
            pages=pages,
        )
        attrs.update(
            source=track.kind,
            words=words,
            pages=len(pages),
            sponsorblock=blocked.state,
        )
        if ratio is not None:
            attrs["sponsor_ratio"] = ratio

    attrs["outcome"] = result["status"]
    attrs["duration_ms"] = round((time.monotonic() - started) * 1000)
    emit(
        "fetch.transcript",
        video_id=video_id,
        **({"request_id": request_id} if request_id else {}),
        attrs=attrs,
    )
    return TranscriptResult.model_validate(result)


def _work(parser: argparse.ArgumentParser, once: bool) -> int:
    from yt_digest_node.daemon import Daemon, read_settings

    env = dict(os.environ)
    try:
        settings = read_settings(env)
        _check_limits(env)
        extractor = make_extractor(env)
    except ValueError as error:  # ConfigError is a ValueError
        parser.error(str(error))
    emit("service.started", attrs={"version": version("yt-digest-node")})
    return Daemon(settings, env, extractor).run(once)


def _check_limits(env: dict[str, str]) -> None:
    for name in ("MAX_WORDS", "PAGE_WORDS"):
        if int(env.get(name, "1")) < 1:
            raise ValueError(f"{name} must be a positive integer")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yt-digest-node")
    commands = parser.add_subparsers(dest="command", required=True)
    transcript = commands.add_parser("transcript")
    transcript.add_argument("video_id")
    transcript.add_argument("--langs")
    transcript.add_argument("--request-id")
    work = commands.add_parser("work")
    work.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "work":
        return _work(parser, once=args.once)
    if not VIDEO_ID.fullmatch(args.video_id):
        parser.error(f"invalid video id: {args.video_id!r}")
    env = dict(os.environ)
    langs = [
        lang.strip()
        for lang in (args.langs or env.get("TRANSCRIPT_LANGS") or "fr,en").split(",")
        if lang.strip()
    ]
    try:
        _check_limits(env)
        extractor = make_extractor(env)
    except ValueError as error:
        parser.error(str(error))
    emit("service.started", attrs={"version": version("yt-digest-node")})
    result = run_transcript(args.video_id, langs, env, extractor, args.request_id)
    print(result.model_dump_json(), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
