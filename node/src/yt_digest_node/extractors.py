"""Extractors and track choice (spec 5.2)."""

import json
import os
import random
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

TrackKind = Literal["manual", "auto"]
Failure = Literal["unavailable", "blocked"]

TIMEOUT_S = 30
DEFAULT_DELAY = (2.0, 5.0)

UNAVAILABLE_MARKERS = (
    "private video",
    "age-restricted",
    "confirm your age",
    "video unavailable",
    "has been removed",
    "this video is not available",
    "account associated with this video has been terminated",
)
BLOCKED_MARKERS = ("not a bot", "confirm you’re not a bot", "confirm you're not a bot")


@dataclass(frozen=True)
class Track:
    lang: str
    kind: TrackKind
    vtt: str


@dataclass(frozen=True)
class Extraction:
    duration: float
    tracks: list[Track]


class Extractor(Protocol):
    def extract(self, video_id: str) -> Extraction | Failure: ...


class FakeExtractor:
    """Reads `<root>/<video_id>/` : `meta.json` and `<lang>.<manual|auto>.vtt` files."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def extract(self, video_id: str) -> Extraction | Failure:
        directory = self.root / video_id
        if not directory.is_dir():
            return "unavailable"
        meta_path = directory / "meta.json"
        meta: dict[str, Any] = (
            json.loads(meta_path.read_text(encoding="utf-8"))
            if meta_path.is_file()
            else {}
        )
        status = meta.get("status")
        if status == "unavailable":
            return "unavailable"
        if status == "blocked":
            return "blocked"
        tracks: list[Track] = []
        for path in sorted(directory.glob("*.vtt")):
            parts = path.name.split(".")
            if len(parts) != 3 or parts[1] not in ("manual", "auto"):
                continue
            kind: TrackKind = "manual" if parts[1] == "manual" else "auto"
            tracks.append(Track(parts[0], kind, path.read_text(encoding="utf-8")))
        return Extraction(float(meta.get("duration", 0)), tracks)


def _download(url: str) -> str:
    with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
        return str(response.read().decode("utf-8"))


def _default_ydl_class() -> Any:
    import yt_dlp  # type: ignore[import-untyped]

    return yt_dlp.YoutubeDL


class YtDlpExtractor:
    """yt-dlp used as a library. `ydl_class` and `download` can be replaced (tests)."""

    def __init__(
        self,
        delay: tuple[float, float] = DEFAULT_DELAY,
        ydl_class: Any = None,
        download: Callable[[str], str] = _download,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.delay = delay
        self.ydl_class = ydl_class
        self.download = download
        self.sleep = sleep

    def options(self) -> dict[str, Any]:
        return {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitlesformat": "vtt",
            "quiet": True,
            "no_warnings": True,
        }

    def extract(self, video_id: str) -> Extraction | Failure:
        self.sleep(random.uniform(*self.delay))
        ydl_class = self.ydl_class or _default_ydl_class()
        try:
            with ydl_class(self.options()) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
        except Exception as error:
            message = str(error).lower()
            if any(marker in message for marker in BLOCKED_MARKERS):
                return "blocked"
            if any(marker in message for marker in UNAVAILABLE_MARKERS):
                return "unavailable"
            raise
        tracks: list[Track] = []
        sources: list[tuple[str, TrackKind]] = [
            ("subtitles", "manual"),
            ("automatic_captions", "auto"),
        ]
        for field, kind in sources:
            by_lang: dict[str, list[dict[str, Any]]] = info.get(field) or {}
            for lang, formats in by_lang.items():
                vtt = next(
                    (f for f in formats if f.get("ext") == "vtt" and f.get("url")), None
                )
                if vtt is not None:
                    tracks.append(Track(lang, kind, self.download(vtt["url"])))
        return Extraction(float(info.get("duration") or 0), tracks)


def make_extractor(env: dict[str, str] | None = None) -> Extractor:
    """The fake extractor when `FETCHER_FAKE_YTDLP=1`, otherwise yt-dlp."""
    env = dict(os.environ) if env is None else env
    if env.get("FETCHER_FAKE_YTDLP") == "1":
        directory = env.get("FAKE_YTDLP_DIR")
        if not directory:
            raise ValueError("FAKE_YTDLP_DIR is required when FETCHER_FAKE_YTDLP=1")
        return FakeExtractor(Path(directory))
    return YtDlpExtractor(delay=parse_delay(env.get("YT_DELAY_SECONDS")))


def parse_delay(value: str | None) -> tuple[float, float]:
    """`YT_DELAY_SECONDS`: `a-b` or a single number; unset gives 2-5."""
    if not value:
        return DEFAULT_DELAY
    low, _, high = value.partition("-")
    return float(low), float(high or low)


def choose_track(tracks: list[Track], langs: list[str]) -> Track | None:
    """Manual tracks in language order, then auto tracks in language order."""
    for kind in ("manual", "auto"):
        for lang in langs:
            for track in tracks:
                if track.kind == kind and track.lang == lang:
                    return track
    return None
