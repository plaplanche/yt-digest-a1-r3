import urllib.error
from collections.abc import Callable
from email.message import Message
from pathlib import Path
from typing import Any, ClassVar, Self

import pytest
from yt_digest_node.extractors import (
    Extraction,
    FakeExtractor,
    Track,
    YtDlpExtractor,
    choose_track,
    make_extractor,
    parse_delay,
)

FIXTURES = Path(__file__).parent / "fixtures" / "fake_ytdlp"
LANGS = ["fr", "en"]


def test_missing_directory_is_unavailable() -> None:
    assert FakeExtractor(FIXTURES).extract("absent", LANGS) == "unavailable"


@pytest.mark.parametrize("status", ["blocked", "unavailable"])
def test_meta_status_is_returned(status: str) -> None:
    assert FakeExtractor(FIXTURES).extract(status, LANGS) == status


def test_fake_reads_duration_and_tracks() -> None:
    result = FakeExtractor(FIXTURES).extract("mixed", LANGS)
    assert isinstance(result, Extraction)
    assert result.duration == 90
    # notes.txt and the misnamed bad.vtt are skipped
    assert sorted((t.lang, t.kind, t.vtt.strip()) for t in result.tracks) == [
        ("en", "manual", "EN"),
        ("fr", "auto", "FR"),
    ]


def test_fake_end_to_end_choice() -> None:
    extractor = FakeExtractor(FIXTURES)
    result = extractor.extract("mixed", LANGS)
    assert isinstance(result, Extraction)
    chosen = choose_track(result.tracks, LANGS)
    assert chosen is not None and (chosen.lang, chosen.kind) == ("en", "manual")
    german = extractor.extract("german", LANGS)
    assert isinstance(german, Extraction)
    assert choose_track(german.tracks, LANGS) is None


def test_fake_without_meta_is_empty_ok() -> None:
    result = FakeExtractor(FIXTURES).extract("nometa", LANGS)
    assert isinstance(result, Extraction) and result.duration == 0
    assert len(result.tracks) == 1


def test_fake_extractor_never_sleeps(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(_: float) -> None:
        raise AssertionError("slept")

    monkeypatch.setattr("time.sleep", fail)
    FakeExtractor(FIXTURES).extract("mixed", LANGS)


def test_invalid_delay_raises() -> None:
    with pytest.raises(ValueError):
        parse_delay("fast")


def test_choice_prefers_manual_over_earlier_auto() -> None:
    tracks = [Track("fr", "auto", "A"), Track("en", "manual", "B")]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]


def test_choice_follows_language_order_then_auto() -> None:
    tracks = [
        Track("en", "manual", "B"),
        Track("fr", "manual", "C"),
        Track("fr", "auto", "D"),
    ]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]
    assert choose_track([tracks[2], Track("en", "auto", "E")], ["en", "fr"]) == Track(
        "en", "auto", "E"
    )


def test_no_matching_track() -> None:
    assert choose_track([Track("de", "manual", "A")], ["fr", "en"]) is None


def test_make_extractor_fake(tmp_path: Path) -> None:
    extractor = make_extractor(
        {"FETCHER_FAKE_YTDLP": "1", "FAKE_YTDLP_DIR": str(tmp_path)}
    )
    assert isinstance(extractor, FakeExtractor)
    with pytest.raises(ValueError):
        make_extractor({"FETCHER_FAKE_YTDLP": "1"})


def test_make_extractor_default_and_delay() -> None:
    extractor = make_extractor({"YT_DELAY_SECONDS": "1-3"})
    assert isinstance(extractor, YtDlpExtractor)
    assert extractor.delay == (1.0, 3.0)
    assert parse_delay(None) == (2.0, 5.0)
    assert parse_delay("4") == (4.0, 4.0)


class StubYdl:
    options: ClassVar[dict[str, Any]] = {}
    urls: ClassVar[list[str]] = []
    info: ClassVar[dict[str, Any]] = {}
    error: ClassVar[Exception | None] = None

    def __init__(self, options: dict[str, Any]) -> None:
        StubYdl.options = options

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def extract_info(self, url: str, download: bool) -> dict[str, Any]:
        assert download is False
        StubYdl.urls.append(url)
        if StubYdl.error:
            raise StubYdl.error
        return StubYdl.info


def stub_extractor(
    sleeps: list[float], download: Callable[[str], str] | None = None
) -> YtDlpExtractor:
    return YtDlpExtractor(
        delay=(2.0, 5.0),
        ydl_class=StubYdl,
        download=download or (lambda url: f"vtt:{url}"),
        sleep=sleeps.append,
    )


def many_langs_info() -> dict[str, Any]:
    langs = [f"l{i}" for i in range(150)] + ["fr", "en"]
    return {
        "duration": 120,
        "subtitles": {
            "en": [{"ext": "json3", "url": "u0"}, {"ext": "vtt", "url": "u1"}]
        },
        "automatic_captions": {
            lang: [{"ext": "vtt", "url": f"a-{lang}"}] for lang in langs
        },
    }


def test_ytdlp_options_and_chosen_track() -> None:
    StubYdl.error = None
    StubYdl.info = many_langs_info()
    sleeps: list[float] = []
    downloads: list[str] = []

    def download(url: str) -> str:
        downloads.append(url)
        return f"vtt:{url}"

    result = stub_extractor(sleeps, download).extract("abc", ["fr", "en"])
    assert StubYdl.options["skip_download"] is True
    assert StubYdl.options["writesubtitles"] is True
    assert StubYdl.options["writeautomaticsub"] is True
    assert StubYdl.options["subtitlesformat"] == "vtt"
    assert StubYdl.options["quiet"] is True
    assert StubYdl.options["no_warnings"] is True
    assert not any("cookie" in key for key in StubYdl.options)
    assert StubYdl.urls[-1].endswith("abc")
    # manual English wins over the auto French one; one download, one delay each
    assert downloads == ["u1"]
    assert len(sleeps) == 2 and all(2.0 <= x <= 5.0 for x in sleeps)
    assert result == Extraction(120, [Track("en", "manual", "vtt:u1")])


def test_ytdlp_falls_back_to_auto_and_none() -> None:
    StubYdl.error = None
    StubYdl.info = many_langs_info()
    result = stub_extractor([]).extract("abc", ["fr"])
    assert result == Extraction(120, [Track("fr", "auto", "vtt:a-fr")])
    assert stub_extractor([]).extract("abc", ["de"]) == Extraction(120, [])


@pytest.mark.parametrize("code", [403, 429])
def test_ytdlp_download_block_is_blocked(code: int) -> None:
    StubYdl.error = None
    StubYdl.info = many_langs_info()

    def download(url: str) -> str:
        raise urllib.error.HTTPError(url, code, "no", Message(), None)

    assert stub_extractor([], download).extract("abc", ["en"]) == "blocked"


def test_ytdlp_other_http_error_is_raised() -> None:
    StubYdl.error = None
    StubYdl.info = many_langs_info()

    def download(url: str) -> str:
        raise urllib.error.HTTPError(url, 500, "no", Message(), None)

    with pytest.raises(urllib.error.HTTPError):
        stub_extractor([], download).extract("abc", ["en"])


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
            "unavailable",
        ),
        (
            "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate",
            "unavailable",
        ),
        ("ERROR: [youtube] abc: This video has been removed", "unavailable"),
        ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "blocked"),
        ("ERROR: [youtube] abc: Sign in to confirm you're not a bot", "blocked"),
    ],
)
def test_ytdlp_errors_are_mapped(message: str, expected: str) -> None:
    StubYdl.error = Exception(message)
    assert stub_extractor([]).extract("abc", ["en"]) == expected


def test_ytdlp_rate_limit_message_is_not_unavailable() -> None:
    StubYdl.error = Exception(
        "Video unavailable. This content isn't available, try again later."
    )
    with pytest.raises(Exception, match="try again later"):
        stub_extractor([]).extract("abc", ["en"])


def test_ytdlp_unknown_error_is_raised() -> None:
    StubYdl.error = Exception("boom")
    with pytest.raises(Exception, match="boom"):
        stub_extractor([]).extract("abc", ["en"])
