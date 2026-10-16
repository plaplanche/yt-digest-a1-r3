import json
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


def make_video(root: Path, files: dict[str, str]) -> None:
    video = root / "vid"
    video.mkdir()
    for name, text in files.items():
        (video / name).write_text(text, encoding="utf-8")


def test_missing_directory_is_unavailable(tmp_path: Path) -> None:
    assert FakeExtractor(tmp_path).extract("vid") == "unavailable"


@pytest.mark.parametrize("status", ["blocked", "unavailable"])
def test_meta_status_is_returned(tmp_path: Path, status: str) -> None:
    make_video(tmp_path, {"meta.json": json.dumps({"duration": 10, "status": status})})
    assert FakeExtractor(tmp_path).extract("vid") == status


def test_fake_reads_duration_and_tracks(tmp_path: Path) -> None:
    make_video(
        tmp_path,
        {
            "meta.json": '{"duration": 90}',
            "fr.auto.vtt": "A",
            "en.manual.vtt": "B",
            "x.txt": "C",
        },
    )
    result = FakeExtractor(tmp_path).extract("vid")
    assert isinstance(result, Extraction)
    assert result.duration == 90
    assert sorted((t.lang, t.kind, t.vtt) for t in result.tracks) == [
        ("en", "manual", "B"),
        ("fr", "auto", "A"),
    ]


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


def stub_extractor(sleeps: list[float]) -> YtDlpExtractor:
    return YtDlpExtractor(
        delay=(2.0, 5.0),
        ydl_class=StubYdl,
        download=lambda url: f"vtt:{url}",
        sleep=sleeps.append,
    )


def test_ytdlp_options_and_tracks() -> None:
    StubYdl.error = None
    StubYdl.info = {
        "duration": 120,
        "subtitles": {
            "en": [{"ext": "json3", "url": "u0"}, {"ext": "vtt", "url": "u1"}]
        },
        "automatic_captions": {"fr": [{"ext": "vtt", "url": "u2"}]},
    }
    sleeps: list[float] = []
    result = stub_extractor(sleeps).extract("abc")
    assert StubYdl.options["skip_download"] is True
    assert StubYdl.options["writesubtitles"] is True
    assert StubYdl.options["writeautomaticsub"] is True
    assert StubYdl.options["subtitlesformat"] == "vtt"
    assert "cookiefile" not in StubYdl.options
    assert "cookiesfrombrowser" not in StubYdl.options
    assert StubYdl.urls[-1].endswith("abc")
    assert len(sleeps) == 1 and 2.0 <= sleeps[0] <= 5.0
    assert result == Extraction(
        120, [Track("en", "manual", "vtt:u1"), Track("fr", "auto", "vtt:u2")]
    )


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
        (
            "ERROR: [youtube] abc: Video unavailable. This video has been removed",
            "unavailable",
        ),
        ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "blocked"),
    ],
)
def test_ytdlp_errors_are_mapped(message: str, expected: str) -> None:
    StubYdl.error = Exception(message)
    assert stub_extractor([]).extract("abc") == expected


def test_ytdlp_unknown_error_is_raised() -> None:
    StubYdl.error = Exception("boom")
    with pytest.raises(Exception, match="boom"):
        stub_extractor([]).extract("abc")
